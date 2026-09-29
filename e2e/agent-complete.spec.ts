import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { runCompleteAgent } from "@/lib/agent/complete";
import { buildCompletePrompt, buildCompleteSchema, COMPLETE_SYSTEM } from "@/lib/agent/complete-prompt";

import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-09 검증 중 **결정적인 부분** — 에이전트가 DB에 남기는 것의 모양과 스키마의 두 갈래.
 *
 * 판단의 품질(어느 태스크를 닫았나)은 평가 세트가 `npm run grade -- complete`로 본다
 * (`e2e/grade/complete.grade.ts`). 여기서는 실호출을 2건만 한다(Luna ≈ $0.004).
 */
test.describe.configure({ mode: "serial" });

const ROOT = "e2e/fixtures/captures/complete";

test.describe("완료 프롬프트", () => {
  test("평가 세트의 태스크 제목과 태그가 프롬프트에 없다", () => {
    const answers = new Set<string>();
    for (const dir of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const { cases } = JSON.parse(readFileSync(`${ROOT}/${dir.name}/expected.json`, "utf8")) as {
        cases: { existingTags: string[]; seedTasks: { title: string }[] }[];
      };
      for (const c of cases) {
        c.existingTags.filter((tag) => tag !== "미분류").forEach((tag) => answers.add(tag));
        c.seedTasks.forEach((task) => answers.add(task.title));
      }
    }

    // 맥락 블록(실제 후보 목록이 실리는 자리)만 빼고 모델이 보는 글 전부.
    const prompt = buildCompletePrompt({ capturedAt: "2026-01-01T00:00:00Z", timezone: "UTC", candidates: [] });
    const text = [
      COMPLETE_SYSTEM,
      prompt.replace(/<context>[\s\S]*?<\/context>/, ""),
      JSON.stringify(buildCompleteSchema(["1"])),
    ].join("\n");

    expect([...answers].filter((answer) => text.includes(answer))).toEqual([]);
  });

  test("날짜만 있는 마감은 시각 없이, 시각이 있으면 시각까지 보인다", () => {
    const prompt = buildCompletePrompt({
      capturedAt: "2026-09-21T00:50:00+09:00",
      timezone: "Asia/Seoul",
      candidates: [
        { key: "1", title: "가", dueAt: "2026-09-21T14:59:59Z", dueHasTime: false, tags: ["업무"] },
        { key: "2", title: "나", dueAt: "2026-09-22T05:30:00Z", dueHasTime: true, tags: [] },
        { key: "3", title: "다", dueAt: null, dueHasTime: false, tags: [] },
      ],
    });
    expect(prompt).toContain("1. 가 (마감 2026-09-21 (월); 태그 업무)");
    expect(prompt).toContain("2. 나 (마감 2026-09-22 (화) 14:30; 태그 없음)");
    expect(prompt).toContain("3. 다 (마감 없음; 태그 없음)");
  });
});

test.describe("완료 에이전트 — 실호출", () => {
  let admin: DochiClient;
  let user: TestUser;

  // 아래 두 실호출이 남긴 것을 뒤의 두 테스트가 **읽기만** 한다 — L-P1-01이 연 칸을 보려고
  // LLM을 더 부르지 않는다.
  let failedJobLogId: string;
  let completedJobLogId: string;
  let completedTaskId: string;

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.user.id);
  });

  const image = async () => ({
    bytes: await readFile(`${ROOT}/01-single-candidate/01-kakao-survey-done.png`),
    mimeType: "image/png",
  });

  test("미완료 태스크가 없으면 아무것도 바꾸지 않고 실패로 남는다", async () => {
    // 후보 0개 → 스키마의 `taskKey`가 `{type:"null"}` 하나뿐인 갈래. 실제 API가 받아 주는지 본다.
    const result = await runCompleteAgent(
      { supabase: user.client, userId: user.user.id },
      { image: await image(), capturedAt: "2026-09-21T00:50:00+09:00", timezone: "Asia/Seoul" },
    );
    expect(result).toMatchObject({
      outcome: "failed",
      created: [],
      completed: null,
      failure: { code: "NO_TASK_TO_COMPLETE" },
    });

    const { data: log } = await user.client
      .from("job_logs")
      .select("source, outcome, failure_reason, capture_summary")
      .eq("id", result.jobLogId)
      .single();
    expect(log).toMatchObject({ source: "capture_complete", outcome: "failed", failure_reason: "NO_TASK_TO_COMPLETE" });
    expect(log!.capture_summary!.length).toBeGreaterThan(0); // 실패해도 요약은 남는다(AGT-8)

    failedJobLogId = result.jobLogId;
  });

  test("캡처 한 장이 태스크 하나를 done으로 바꾸고 작업 로그를 남긴다", async () => {
    const { data: tag } = await user.client
      .from("tags")
      .insert({ user_id: user.user.id, name: "연구" })
      .select("id")
      .single();
    for (const title of ["PULSE 사전 설문조사 응답하기", "교양 발표 PPT 검토"]) {
      const { error } = await user.client.rpc("create_task", {
        p_title: title,
        p_due_at: "2026-09-21T14:59:59Z",
        p_due_has_time: false,
        p_tag_ids: [tag!.id],
      });
      expect(error).toBeNull();
    }

    const result = await runCompleteAgent(
      { supabase: user.client, userId: user.user.id },
      { image: await image(), capturedAt: "2026-09-21T00:50:00+09:00", timezone: "Asia/Seoul" },
    );

    expect(result.outcome).toBe("completed");
    expect(result.failure).toBeNull();
    expect(result.created).toEqual([]);
    expect(result.completed?.title).toBe("PULSE 사전 설문조사 응답하기");

    // 반환값이 DB와 같은지, 그리고 **하나만** 바뀌었는지(`AGT-6`).
    const { data: rows } = await user.client.from("tasks").select("id, title, status").order("title");
    expect(rows).toEqual([
      { id: result.completed!.id, title: "PULSE 사전 설문조사 응답하기", status: "done" },
      expect.objectContaining({ title: "교양 발표 PPT 검토", status: "todo" }),
    ]);

    const { data: log } = await user.client
      .from("job_logs")
      .select("source, outcome, failure_reason, capture_summary, model, prompt_tokens, completion_tokens, latency_ms")
      .eq("id", result.jobLogId)
      .single();
    expect(log).toMatchObject({ source: "capture_complete", outcome: "completed", failure_reason: null });
    expect(log!.capture_summary!.length).toBeGreaterThan(0);
    expect(log!.model).toMatch(/^(bedrock-)?gpt-5\.6-/);
    expect(log!.prompt_tokens).toBeGreaterThan(0);
    expect(log!.completion_tokens).toBeGreaterThan(0);
    expect(log!.latency_ms).toBeLessThan(10_000);

    console.log("완료 에이전트 실측", JSON.stringify({ ...log, title: result.completed!.title }));

    completedJobLogId = result.jobLogId;
    completedTaskId = result.completed!.id;
  });

  test("닫힌 태스크가 그 완료 로그를 가리킨다", async () => {
    // L-P1-01이 연 연결 칸. 되돌리기(HIST-3)가 이것 하나로 "무엇을 닫았나"를 안다.
    const { data: rows } = await user.client
      .from("tasks")
      .select("title, status, completed_by_job_log_id")
      .order("title");

    expect(rows).toEqual([
      // 닫지 않은 태스크에는 찍히지 않는다 — 연결이 실제 결과를 따라간다.
      { title: "PULSE 사전 설문조사 응답하기", status: "done", completed_by_job_log_id: completedJobLogId },
      { title: "교양 발표 PPT 검토", status: "todo", completed_by_job_log_id: null },
    ]);

    const { data: closed } = await user.client
      .from("tasks")
      .select("id")
      .eq("completed_by_job_log_id", completedJobLogId)
      .single();
    expect(closed!.id).toBe(completedTaskId);
  });

  test("완료 캡처가 근거를 로그에 남긴다 — 태스크가 아니라", async () => {
    const { data: logs } = await user.client
      .from("job_logs")
      .select("id, outcome, rationale")
      .in("id", [completedJobLogId, failedJobLogId]);

    // 성공에도 실패에도 근거가 있다. 프롬프트가 "왜 끝났는지, 또는 왜 닫을 것이 없는지"를 요구한다.
    expect(logs).toHaveLength(2);
    for (const log of logs!) {
      expect(log.rationale?.trim().length ?? 0).toBeGreaterThan(0);
    }

    // 완료 근거는 태스크가 아니라 로그에 산다. 그 태스크는 `create_task`가 근거 없이 만들었고
    // 완료 에이전트가 그 칸을 건드리지 않는다 — 에이전트는 생성과 완료만 한다(제품 규칙).
    const { data: task } = await user.client
      .from("tasks")
      .select("rationale")
      .eq("id", completedTaskId)
      .single();
    expect(task!.rationale).toBeNull();
  });
});
