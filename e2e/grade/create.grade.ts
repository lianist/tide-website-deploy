import { expect, test } from "@playwright/test";

import { runCreateAgent } from "@/lib/agent/create";

import { createAdminClient, createSignedInUser, deleteUser } from "../support/supabase";
import { type BaseCase, DECOY_TASKS, loadCases, readCaptureImage, type SeedTask, seedTags, seedTasks } from "./support";

/**
 * 생성 캡처 평가 세트 실행기 — `L-P0-08`. 데이터와 비교 규칙은 `e2e/fixtures/captures/README.md`.
 *
 * 케이스 하나가 테스트 하나다. 케이스마다 새 사용자를 만들고, `existingTags`를 심고, 에이전트를
 * **실제 LLM으로** 돌린 뒤 DB에 남은 태스크를 기대 결과와 비교한다. 문자열이 같기를 기대하지 않는다 —
 * 개수·제목 조각·마감(명시된 정밀도까지)·태그만 본다.
 *
 * **모든 케이스에 미끼 미완료 태스크 20건을 먼저 깐다**(`L-P1-08`, `decoy-tasks.json`). 후보가 있는
 * 실사용 조건에서 지연을 재고, 미끼를 중복으로 묶으면(`duplicates`가 기대와 다르면) 실패다.
 *
 * `npm run grade` — 게이트는 `--repeat-each=3`으로 3회 연속 전부 통과다(ROADMAP L-P0-08).
 */
test.describe.configure({ mode: "parallel" });

/**
 * `GRADE_SET=holdout`이면 보류 세트를 돈다. 보류 세트는 **프롬프트를 고치는 데 쓰지 않고** 일반성만
 * 확인한다(`e2e/fixtures/captures/holdout/README.md`).
 */
const ROOT = `e2e/fixtures/captures/${process.env.GRADE_SET === "holdout" ? "holdout/create" : "create"}`;

interface ExpectedTask {
  titleMustMention: string[];
  titleMustMentionMode?: "all" | "any";
  dueAt?: string | null;
  dueAtOneOf?: string[];
  /** 정확히 이 태그 집합. `newTag`와 둘 중 하나만 쓴다. */
  tags?: string[];
  /**
   * 태그가 정확히 하나이고, `existingTags`에 없는 **새 태그**다(HF-10 콜드 스타트). 새 태그의 이름은
   * 모델이 짓는 것이라 문자열로 고정하지 않는다 — 여기서 재는 것은 "'미분류'로 떨어지지 않았다"뿐이다.
   */
  newTag?: true;
}

interface Case extends BaseCase {
  /** 케이스 고유의 기존 태스크. 중복 케이스(`07-duplicate`)만 든다. 미끼보다 나중에 심는다. */
  seedTasks?: SeedTask[];
  expect: {
    outcome: "created" | "failed";
    failureCode?: string;
    taskCount: number | [number, number];
    tasks: ExpectedTask[];
    /** 중복으로 판정돼야 할 기존 태스크 제목(`seedTasks`의 title 그대로). 없으면 `[]`이 기대값이다. */
    duplicates?: string[];
  };
}

interface Actual {
  title: string;
  dueAt: string | null;
  tags: string[];
  rationale: string | null;
}

/** 그 순간이 `timeZone`에서 며칠인지 — 날짜 정밀도의 기대값과 비교한다. */
function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

/** `2026-09-21`이면 날짜까지, 시각이 붙어 있으면 순간까지 비교한다(README §비교 규칙). */
function dueMatches(expected: string | null, actual: string | null, timeZone: string): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expected)) return localDate(actual, timeZone) === expected;
  return Date.parse(expected) === Date.parse(actual);
}

function titleMatches(want: ExpectedTask, title: string): boolean {
  const hits = want.titleMustMention.map((fragment) => title.includes(fragment));
  return want.titleMustMentionMode === "any" ? hits.some(Boolean) : hits.every(Boolean);
}

/** 기대 태스크 하나가 실제 태스크 하나와 맞는지. 어긋나면 이유를 돌려준다. */
function mismatch(want: ExpectedTask, got: Actual, timeZone: string, existingTags: string[]): string | null {
  if (!titleMatches(want, got.title)) return `제목(${got.title})`;
  const dues = want.dueAtOneOf ?? [want.dueAt ?? null];
  if (!dues.some((due) => dueMatches(due, got.dueAt, timeZone))) return `마감(${got.dueAt})`;
  if (want.newTag) {
    if (got.tags.length !== 1 || existingTags.includes(got.tags[0]!)) return `새 태그 아님(${got.tags.join()})`;
  } else if ([...got.tags].sort().join() !== [...(want.tags ?? [])].sort().join()) {
    return `태그(${got.tags.join()})`;
  }
  if (!got.rationale?.trim()) return "근거 없음";
  return null;
}

for (const c of loadCases<Case>(ROOT)) {
  test(c.name, async () => {
    test.setTimeout(60_000);
    const admin = createAdminClient();
    const user = await createSignedInUser(admin);

    try {
      const tagIds = await seedTags(user, c.existingTags);
      await seedTasks(user, tagIds, [...DECOY_TASKS, ...(c.seedTasks ?? [])], c.timezone);

      const result = await runCreateAgent(
        { supabase: user.client, userId: user.user.id },
        {
          image: await readCaptureImage(c.folder, c.image),
          capturedAt: c.capturedAt,
          timezone: c.timezone,
        },
      );

      // 판정은 반환값이 아니라 **DB에 남은 것**으로 한다. 사용자가 보게 되는 것이 그것이다.
      const [{ data: rows }, { data: log }] = await Promise.all([
        // 이 캡처가 만든 것만 — 심어 둔 미끼·기존 태스크를 세지 않는다.
        user.client
          .from("tasks")
          .select("title, due_at, rationale, task_tags(tags(name))")
          .eq("job_log_id", result.jobLogId),
        user.client
          .from("job_logs")
          .select("outcome, failure_reason, capture_summary, latency_ms, prompt_tokens, completion_tokens")
          .eq("id", result.jobLogId)
          .single(),
      ]);
      const actual: Actual[] = (rows ?? []).map((row) => ({
        title: row.title,
        dueAt: row.due_at,
        tags: row.task_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])),
        rationale: row.rationale,
      }));

      // 실패하면 무엇이 나왔는지부터 봐야 프롬프트를 고칠 수 있다.
      console.log(
        `[grade] ${c.name}`,
        JSON.stringify({
          latencyMs: log?.latency_ms,
          tokens: [log?.prompt_tokens, log?.completion_tokens],
          summary: log?.capture_summary,
          duplicates: result.duplicates.map((t) => t.title),
          tasks: actual.map((t) => ({
            title: t.title,
            dueAt: t.dueAt && new Date(t.dueAt).toLocaleString("sv-SE", { timeZone: c.timezone }),
            tags: t.tags,
          })),
        }),
      );

      expect(log?.outcome, "작업 로그 결말").toBe(c.expect.outcome);
      expect(log?.failure_reason ?? null, "실패 코드").toBe(c.expect.failureCode ?? null);
      expect(log?.capture_summary?.trim(), "요약(AGT-8)").toBeTruthy();
      // 정확히 같은 집합 — 빠지면 중복 놓침, 남으면(미끼 포함) 거짓 중복이다(`AGT-11`).
      expect(result.duplicates.map((t) => t.title).sort(), "중복(AGT-11)").toEqual([...(c.expect.duplicates ?? [])].sort());

      const [min, max] = Array.isArray(c.expect.taskCount)
        ? c.expect.taskCount
        : [c.expect.taskCount, c.expect.taskCount];
      expect(actual.length, `태스크 개수 ${min}~${max}`).toBeGreaterThanOrEqual(min);
      expect(actual.length, `태스크 개수 ${min}~${max}`).toBeLessThanOrEqual(max);

      // 기대 태스크마다 서로 다른 실제 태스크 하나가 맞아야 한다(탐욕 매칭).
      const unused = [...actual];
      for (const want of c.expect.tasks) {
        const reasons = unused.map((got) => mismatch(want, got, c.timezone, c.existingTags));
        const index = reasons.indexOf(null);
        expect(index, `기대 태스크 [${want.titleMustMention.join("/")}] — 후보별 불일치: ${reasons.join(", ")}`)
          .toBeGreaterThanOrEqual(0);
        unused.splice(index, 1);
      }
    } finally {
      await deleteUser(admin, user.user.id);
    }
  });
}
