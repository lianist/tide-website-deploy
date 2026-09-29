import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { loadTagIds, planCreate, runCreateAgent, type ExistingTask } from "@/lib/agent/create";
import { buildCreatePrompt, buildCreateSchema, CREATE_SYSTEM, type CreateOutput } from "@/lib/agent/create-prompt";
import { mergeTags, renameTag } from "@/lib/api/tags";
import { formatLocal, toDueAt } from "@/lib/time";

import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-08 검증 중 **결정적인 부분** — 시간 환산과, 에이전트가 DB에 남기는 것의 모양.
 *
 * 판단의 품질(개수·마감·태그가 맞는가)은 여기서 보지 않는다. 그건 평가 세트 11건이
 * `npm run grade`로 본다(`e2e/grade/create.grade.ts`). 여기서는 실호출을 1건만 한다(Luna ≈ $0.002).
 */
test.describe.configure({ mode: "serial" });

test.describe("시간 환산", () => {
  test("캡처 시각은 현지 날짜·요일·시각으로 보인다", () => {
    expect(formatLocal("2026-09-19T21:00:00+09:00", "Asia/Seoul")).toBe("2026-09-19 (토) 21:00");
    // UTC로 온 값도 사용자 시간대의 날짜로 넘어간다 — 요일 계산이 여기서 틀리면 '다음 주 월요일'이 밀린다.
    expect(formatLocal("2026-09-19T15:30:00Z", "Asia/Seoul")).toBe("2026-09-20 (일) 00:30");
  });

  test("날짜만 있는 마감은 그날의 끝, 시각이 있으면 그 시각", () => {
    expect(toDueAt("2026-09-21", null, "Asia/Seoul")).toBe("2026-09-21T14:59:59.000Z");
    expect(toDueAt("2026-09-21", "08:30", "Asia/Seoul")).toBe("2026-09-20T23:30:00.000Z");
  });

  test("서머타임 경계 양쪽에서 오프셋이 맞다", () => {
    // 뉴욕은 2026-03-08 02:00에 EST(-5) → EDT(-4)로 넘어간다.
    expect(toDueAt("2026-03-07", "12:00", "America/New_York")).toBe("2026-03-07T17:00:00.000Z");
    expect(toDueAt("2026-03-09", "12:00", "America/New_York")).toBe("2026-03-09T16:00:00.000Z");
  });

  test("실재하지 않는 날짜·시각은 비운다", () => {
    expect(toDueAt("2026-02-30", null, "Asia/Seoul")).toBeNull();
    expect(toDueAt("2026-09-21", "25:00", "Asia/Seoul")).toBeNull();
  });
});

test.describe("프롬프트 누수 가드", () => {
  /**
   * 지시문 자체의 어휘라 제목 힌트가 될 수 없는 조각. '태그 **이름**', '사용자에게 **질문**하지 않는다'.
   * 여기에 단어를 더하려면 그 단어가 정답을 암시하지 않는다는 이유를 옆에 적는다.
   */
  const VOCABULARY = new Set(["이름", "질문"]);

  test("평가·보류 세트의 정답 조각과 태그가 프롬프트에 없다", () => {
    const answers = new Set<string>();
    for (const root of ["e2e/fixtures/captures/create", "e2e/fixtures/captures/holdout/create"])
    for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const { cases } = JSON.parse(readFileSync(`${root}/${dir.name}/expected.json`, "utf8")) as {
        cases: {
          existingTags: string[];
          seedTasks?: { title: string }[];
          expect: { tasks: { titleMustMention: string[] }[] };
        }[];
      };
      for (const c of cases) {
        c.existingTags.filter((tag) => tag !== "미분류").forEach((tag) => answers.add(tag));
        c.expect.tasks.flatMap((t) => t.titleMustMention).forEach((f) => answers.add(f));
        // 중복 케이스(`07-duplicate`)의 기존 태스크 제목도 정답이다 — 예시에 비슷한 쌍을 두면 그 시험지만 푼다.
        c.seedTasks?.forEach((t) => answers.add(t.title));
      }
    }

    // 맥락 블록(실제 태그 목록이 실리는 자리)만 빼고 모델이 보는 글 전부.
    const prompt = buildCreatePrompt({ capturedAt: "2026-01-01T00:00:00Z", timezone: "UTC", existingTags: [], openTasks: [] });
    const schema = JSON.stringify(buildCreateSchema(["1"]));
    const text = [CREATE_SYSTEM, prompt.replace(/<context>[\s\S]*?<\/context>/, ""), schema].join("\n");

    // 평가 세트에 맞춘 문구가 들어가면 점수는 오르지만 일반성은 사라진다 — 예시는 다른 도메인으로 쓴다.
    const leaked = [...answers].filter((answer) => !VOCABULARY.has(answer) && text.includes(answer));
    expect(leaked).toEqual([]);
  });
});

test.describe("에이전트는 바뀐 태그 목록을 따른다", () => {
  /**
   * `DASH-6`의 두 번째 문장 — *"이후 에이전트의 태그 배정(`AGT-5`)도 바뀐 목록을 기준으로 해야
   * 한다."* 구조적으로는 이미 성립한다(`loadTagIds`를 호출마다 부른다). 여기서 하는 일은 그 사실을
   * **고정**해, 나중에 목록을 캐시하고 싶어질 때 빨간불이 켜지게 만드는 것이다.
   *
   * **LLM을 부르지 않는다.** 프롬프트 문자열까지만 만들어 본다 — 모델이 그 목록을 어떻게 쓰는지는
   * 평가 세트(`npm run grade`)의 몫이고, 여기서 재면 이 테스트가 에이전트 품질의 인질이 된다(L4).
   */
  let admin: DochiClient;
  let user: TestUser;

  /** 프롬프트에 실제로 실린 목록. 예시 블록의 `existing_tags`는 평문이라 이 정규식에 안 걸린다. */
  const tagsInPrompt = (prompt: string): string[] => {
    const block = /<existing_tags>(.*?)<\/existing_tags>/.exec(prompt);
    expect(block).not.toBeNull();
    return block![1]!.split(", ").filter(Boolean).sort();
  };

  const promptTags = async (): Promise<string[]> => {
    const tagIds = await loadTagIds({ supabase: user.client, userId: user.user.id });
    return tagsInPrompt(
      buildCreatePrompt({
        capturedAt: "2026-01-01T00:00:00Z",
        timezone: "Asia/Seoul",
        existingTags: [...tagIds.keys()],
        openTasks: [],
      }),
    );
  };

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.user.id);
  });

  test("병합·이름 변경이 다음 호출의 프롬프트에 그대로 반영된다", async () => {
    const { data: seeded, error } = await user.client
      .from("tags")
      .insert(["학업", "업무", "잡동사니"].map((name) => ({ user_id: user.user.id, name })))
      .select("id, name");
    expect(error).toBeNull();

    // 가입 트리거의 '미분류'까지 넷. 순서는 미지정이라(`loadTagIds`에 `.order()`가 없다) 집합으로 본다.
    expect(await promptTags()).toEqual(["미분류", "업무", "잡동사니", "학업"]);

    const junk = seeded!.find((tag) => tag.name === "잡동사니")!;
    const work = seeded!.find((tag) => tag.name === "업무")!;
    const study = seeded!.find((tag) => tag.name === "학업")!;

    // ① 병합 — 사라진 이름이 다음 프롬프트에 없다.
    const merged = await mergeTags(user.client, { sourceId: junk.id, targetId: work.id });
    expect(merged.ok).toBe(true);
    expect(await promptTags()).toEqual(["미분류", "업무", "학업"]);

    // ② 이름 변경 — 새 이름이 들어 있고 옛 이름은 없다.
    const renamed = await renameTag(user.client, study.id, "대학원");
    expect(renamed.ok).toBe(true);
    expect(await promptTags()).toEqual(["대학원", "미분류", "업무"]);
  });
});

test.describe("중복 판정 (AGT-11)", () => {
  /**
   * 구조만 본다 — 스키마가 후보 번호를 정확히 가두는가, 모델 출력이 세 분기로 옳게 조립되는가.
   * **LLM을 부르지 않는다.** 모델이 같은 일을 알아보는지는 평가 세트(`create/07-duplicate`)의 몫이다(L4).
   */
  type Task = CreateOutput["tasks"][number];
  const task = (title: string, duplicateOfKey: string | null): Task => ({
    title,
    description: null,
    dueDate: null,
    dueTime: null,
    tags: [],
    rationale: "근거",
    duplicateOfKey,
  });
  const output = (...tasks: Task[]): CreateOutput => ({ quotes: [], summary: "요약", tasks });
  const existing: ExistingTask[] = [
    { id: "00000000-0000-0000-0000-00000000000a", title: "보고서 제출하기" },
    { id: "00000000-0000-0000-0000-00000000000b", title: "회의실 예약하기" },
  ];
  const candidates = new Map(existing.map((t, i) => [String(i + 1), t]));

  /** 스키마에서 `duplicateOfKey` 칸을 꺼낸다. 모양은 `buildCompleteSchema`의 `taskKey`와 같다. */
  const duplicateField = (keys: string[]) =>
    (buildCreateSchema(keys).jsonSchema.properties.tasks.items.properties as Record<string, unknown>)
      .duplicateOfKey as { type?: string; anyOf?: [{ enum: string[] }, { type: string }] };

  test("스키마의 번호 열거형이 그 요청의 후보 번호와 정확히 같다", () => {
    const field = duplicateField(["1", "2", "3"]);
    expect(field.anyOf![0].enum).toEqual(["1", "2", "3"]);
    expect(field.anyOf![1]).toEqual({ type: "null" });
    // 칸이 필수여야 모델이 판정을 건너뛰지 못한다(strict 스키마는 모든 칸을 required로 요구하기도 한다).
    expect(buildCreateSchema(["1"]).jsonSchema.properties.tasks.items.required).toContain("duplicateOfKey");
  });

  test("후보가 없으면 null만 허용한다 — 빈 열거형을 만들지 않는다", () => {
    const field = duplicateField([]);
    expect(field.type).toBe("null");
    expect(field.anyOf).toBeUndefined();
  });

  test("전부 중복이면 아무것도 만들지 않고 DUPLICATE_TASK, 메시지에 기존 제목", () => {
    const one = planCreate(output(task("보고서 내기", "1")), candidates);
    expect(one).toEqual({
      toCreate: [],
      duplicates: [existing[0]],
      failure: { code: "DUPLICATE_TASK", message: "이미 있는 태스크예요: 보고서 제출하기" },
    });

    // 둘이 같은 기존 태스크를 가리키면 한 번만 싣는다. 서로 다른 둘이면 "외 N건".
    const same = planCreate(output(task("보고서 내기", "1"), task("보고서 보내기", "1")), candidates);
    expect(same.duplicates).toEqual([existing[0]]);
    const both = planCreate(output(task("보고서 내기", "1"), task("회의실 잡기", "2")), candidates);
    expect(both.duplicates).toEqual(existing);
    expect(both.failure!.message).toBe("이미 있는 태스크예요: 보고서 제출하기 외 1건");
  });

  test("일부만 중복이면 created — 새 일만 만들고 duplicates도 함께 낸다", () => {
    const plan = planCreate(output(task("보고서 내기", "1"), task("출장비 정산하기", null)), candidates);
    expect(plan.failure).toBeNull();
    expect(plan.toCreate.map((t) => t.title)).toEqual(["출장비 정산하기"]);
    expect(plan.duplicates).toEqual([existing[0]]);
  });

  test("중복이 없으면 duplicates는 빈 배열, 할 일이 없으면 기존 NO_TASK_TO_CREATE", () => {
    const plan = planCreate(output(task("출장비 정산하기", null)), candidates);
    expect(plan).toMatchObject({ duplicates: [], failure: null });
    expect(plan.toCreate).toHaveLength(1);

    // 제목이 빈 태스크는 없는 것과 같다 — 중복 판정보다 먼저 걸러진다.
    expect(planCreate(output(task("  ", "1")), candidates)).toEqual({
      toCreate: [],
      duplicates: [],
      failure: { code: "NO_TASK_TO_CREATE", message: "생성할 태스크가 없어요." },
    });
  });

  test("후보에 없는 번호는 중복이 아닌 것으로 친다 — 할 일을 잃지 않는 쪽", () => {
    const plan = planCreate(output(task("출장비 정산하기", "9")), candidates);
    expect(plan).toMatchObject({ duplicates: [], failure: null });
    expect(plan.toCreate).toHaveLength(1);
  });

  test("후보는 번호와 제목만 프롬프트에 실린다", () => {
    const prompt = buildCreatePrompt({
      capturedAt: "2026-01-01T00:00:00Z",
      timezone: "Asia/Seoul",
      existingTags: [],
      openTasks: [...candidates].map(([key, t]) => ({ key, title: t.title })),
    });
    expect(/<open_tasks>\n([\s\S]*?)\n<\/open_tasks>/.exec(prompt)![1]).toBe("1. 보고서 제출하기\n2. 회의실 예약하기");
    // id는 서버만 쥔다.
    expect(prompt).not.toContain(existing[0]!.id);
  });

  test("LLM 호출은 여전히 한 번이다 — 판정을 두 번째 호출로 빼지 않는다", async () => {
    // 코드 경로로 확인한다. 두 번째 호출은 p90 꼬리를 둘로 만들어 10초 예산(`AGT-9`)을 깬다(설계 결정 27).
    const source = await readFile("lib/agent/create.ts", "utf8");
    expect(source.match(/\banalyzeImage\s*[<(]/g)).toHaveLength(1);
  });
});

test.describe("생성 에이전트 — 실호출", () => {
  let admin: DochiClient;
  let user: TestUser;

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.user.id);
  });

  test("캡처 한 장이 태스크·태그·작업 로그로 남는다", async () => {
    const { error: seedError } = await user.client
      .from("tags")
      .insert(["군무", "학업", "여행"].map((name) => ({ user_id: user.user.id, name })));
    expect(seedError).toBeNull();

    const bytes = await readFile("e2e/fixtures/captures/create/01-single-task/01-military-email-excel-due-jan26.jpeg");
    const result = await runCreateAgent(
      { supabase: user.client, userId: user.user.id },
      { image: { bytes, mimeType: "image/jpeg" }, capturedAt: "2026-01-15T13:00:00+09:00", timezone: "Asia/Seoul" },
    );

    expect(result.outcome).toBe("created");
    expect(result.failure).toBeNull();
    expect(result.completed).toBeNull();
    expect(result.duplicates).toEqual([]); // 미완료 태스크가 없는 계정이다
    expect(result.created).toHaveLength(1);

    // 반환값이 DB와 같은지 — 캡처 API는 이 반환값을 그대로 앱에 보낸다.
    const created = result.created[0]!;
    const { data: row, error } = await user.client
      .from("tasks")
      .select("title, due_at, due_has_time, status, source, rationale, job_log_id, task_tags(tags(name))")
      .eq("id", created.id)
      .single();
    expect(error).toBeNull();
    expect(row!.title).toBe(created.title);
    expect(new Date(row!.due_at!).toISOString()).toBe(created.dueAt);
    expect(created.dueAt).toBe("2026-01-26T14:59:59.000Z"); // 날짜만 → KST 그날의 끝
    expect(row!.due_has_time).toBe(false);
    expect(row!.status).toBe("todo");
    expect(row!.source).toBe("capture_create");
    expect(row!.rationale!.length).toBeGreaterThan(0);
    expect(row!.job_log_id).toBe(result.jobLogId);
    expect(row!.task_tags.map((t) => t.tags!.name)).toEqual(created.tags);
    expect(created.tags).toEqual(["군무"]);

    const { data: log } = await user.client
      .from("job_logs")
      .select("source, outcome, failure_reason, capture_summary, model, prompt_tokens, completion_tokens, latency_ms")
      .eq("id", result.jobLogId)
      .single();
    expect(log).toMatchObject({ source: "capture_create", outcome: "created", failure_reason: null });
    expect(log!.capture_summary!.length).toBeGreaterThan(0);
    expect(log!.model).toMatch(/^(bedrock-)?gpt-5\.6-/);
    expect(log!.prompt_tokens).toBeGreaterThan(0);
    expect(log!.completion_tokens).toBeGreaterThan(0);
    expect(log!.latency_ms).toBeLessThan(10_000);

    console.log("생성 에이전트 실측", JSON.stringify({ ...log, title: created.title }));
  });
});
