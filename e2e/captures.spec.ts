import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { MAX_IMAGE_BYTES, runCapture } from "@/lib/api/captures";

import { bearer, dataOf, expectFailure, type CaptureData } from "./support/api";
import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-10 검증 — `POST /api/v1/captures`의 네 경로(생성·완료·실패·타임아웃)와 입력 검증.
 *
 * 판단의 품질은 평가 세트(`npm run grade`)가 본다. 여기서는 **앱이 응답 하나로 알림을 만들 수 있는지**
 * (`docs/05-UI-Spec.md` §이 표가 웹에 지우는 의무)와 작업 로그가 남는지를 본다. 실호출 3건(≈ $0.005).
 */
test.describe.configure({ mode: "serial" });

const CAPTURES = "/api/v1/captures";
const FIXTURES = "e2e/fixtures/captures";

type Multipart = Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;

async function fixture(path: string, mimeType: string) {
  return { name: path.split("/").pop()!, mimeType, buffer: await readFile(`${FIXTURES}/${path}`) };
}

test.describe("캡처 API", () => {
  let admin: DochiClient;
  let user: TestUser;
  let valid: Multipart;

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
    valid = {
      image: await fixture("create/01-single-task/01-military-email-excel-due-jan26.jpeg", "image/jpeg"),
      mode: "create",
      capturedAt: "2026-01-15T13:00:00+09:00",
      timezone: "Asia/Seoul",
    };
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.user.id);
  });

  const post = (request: import("@playwright/test").APIRequestContext, multipart: Multipart) =>
    request.post(CAPTURES, { headers: bearer(user.accessToken), multipart });

  const jobLog = async (id: string) =>
    (
      await user.client
        .from("job_logs")
        .select("source, outcome, failure_reason, capture_summary, model, prompt_tokens, completion_tokens, latency_ms")
        .eq("id", id)
        .single()
    ).data!;

  test("토큰이 없으면 401", async ({ request }) => {
    await expectFailure(await request.post(CAPTURES, { multipart: valid }), "UNAUTHORIZED", 401);
  });

  test("형식이 틀린 요청은 LLM을 부르지 않고 400", async ({ request }) => {
    const { image, ...rest } = valid;
    const jpeg = image as Exclude<Multipart[string], string>;
    const cases: [string, Multipart][] = [
      ["이미지 없음", rest],
      ["빈 파일", { ...valid, image: { name: "a.png", mimeType: "image/png", buffer: Buffer.alloc(0) } }],
      // Flutter `MultipartFile`의 기본 타입. 계약이 image/* 명시를 요구한다.
      ["타입 없는 파트", { ...valid, image: { ...jpeg, mimeType: "application/octet-stream" } }],
      ["4MB 초과", { ...valid, image: { name: "a.png", mimeType: "image/png", buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1) } }],
      ["모드", { ...valid, mode: "delete" }],
      ["캡처 시각", { ...valid, capturedAt: "어제" }],
      ["시간대", { ...valid, timezone: "Mars/Olympus" }],
    ];
    for (const [label, multipart] of cases) {
      await test.step(label, async () => expectFailure(await post(request, multipart), "VALIDATION_FAILED", 400));
    }
    // JSON 본문도 400이다(multipart가 아님).
    await expectFailure(
      await request.post(CAPTURES, { headers: bearer(user.accessToken), data: { mode: "create" } }),
      "VALIDATION_FAILED",
      400,
    );

    const { count } = await user.client.from("job_logs").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  test("생성 — 응답 하나에 알림의 모든 칸이 있다", async ({ request }) => {
    const started = Date.now();
    const data = await dataOf<CaptureData>(await post(request, valid));
    const elapsed = Date.now() - started;

    expect(data.outcome).toBe("created");
    expect(data.completed).toBeNull();
    // 중복이 없어도 칸은 있다(`AGT-11`) — 앱이 `duplicates` 유무로 분기하지 않고 길이만 보게.
    expect(data.duplicates).toEqual([]);
    expect(data.failure).toBeNull();
    expect(data.created.length).toBeGreaterThan(0);
    for (const task of data.created) {
      expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.rationale.length).toBeGreaterThan(0);
      expect(task.tags.length).toBeGreaterThan(0);
      expect(typeof task.dueHasTime).toBe("boolean");
    }

    // [대시보드 바로가기] 대상이 실제 태스크이고, 그 태스크가 이 로그를 가리킨다.
    const { data: rows } = await user.client.from("tasks").select("id, source, job_log_id");
    expect(rows).toEqual(
      expect.arrayContaining(
        data.created.map((t) => ({ id: t.id, source: "capture_create", job_log_id: data.jobLogId })),
      ),
    );

    const log = await jobLog(data.jobLogId);
    expect(log).toMatchObject({ source: "capture_create", outcome: "created", failure_reason: null });
    expect(log.capture_summary!.length).toBeGreaterThan(0);
    expect(log.prompt_tokens).toBeGreaterThan(0);
    console.log("캡처 생성 실측", JSON.stringify({ elapsedMs: elapsed, llmMs: log.latency_ms, titles: data.created.map((t) => t.title) }));
  });

  test("완료 — 응답의 completed가 실제로 done이 된 태스크다", async ({ request }) => {
    const { data: id, error } = await user.client.rpc("create_task", {
      p_title: "PULSE 사전 설문조사 응답하기",
      p_due_at: "2026-09-21T14:59:59Z",
      p_due_has_time: false,
    });
    expect(error).toBeNull();

    const started = Date.now();
    const data = await dataOf<CaptureData>(
      await post(request, {
        image: await fixture("complete/01-single-candidate/01-kakao-survey-done.png", "image/png"),
        mode: "complete",
        capturedAt: "2026-09-21T00:50:00+09:00",
        timezone: "Asia/Seoul",
      }),
    );
    const elapsed = Date.now() - started;

    expect(data).toMatchObject({
      outcome: "completed",
      created: [],
      completed: { id, title: "PULSE 사전 설문조사 응답하기" },
      duplicates: [], // 완료는 중복을 판정하지 않지만 응답 모양은 생성과 한 벌이다
      failure: null,
    });
    const { data: task } = await user.client.from("tasks").select("status").eq("id", id!).single();
    expect(task!.status).toBe("done");
    expect(await jobLog(data.jobLogId)).toMatchObject({ source: "capture_complete", outcome: "completed" });
    console.log("캡처 완료 실측", JSON.stringify({ elapsedMs: elapsed }));
  });

  test("실패 — 업무 무관 캡처는 200 + data.failure, 요약은 남는다", async ({ request }) => {
    const before = (await user.client.from("tasks").select("id")).data!.length;

    const data = await dataOf<CaptureData>(
      await post(request, {
        image: await fixture("create/04-unrelated/01-strawberry.jpg", "image/jpeg"),
        mode: "create",
        capturedAt: "2026-09-20T22:00:00+09:00",
        timezone: "Asia/Seoul",
      }),
    );

    expect(data).toMatchObject({
      outcome: "failed",
      created: [],
      completed: null,
      duplicates: [],
      failure: { code: "NO_TASK_TO_CREATE" },
    });
    expect(data.failure!.message.length).toBeGreaterThan(0); // 알림 본문 한 줄
    expect((await user.client.from("tasks").select("id")).data!.length).toBe(before);

    const log = await jobLog(data.jobLogId);
    expect(log).toMatchObject({ source: "capture_create", outcome: "failed", failure_reason: "NO_TASK_TO_CREATE" });
    expect(log.capture_summary!.length).toBeGreaterThan(0); // AGT-8
  });

  test("타임아웃 — 504 AGENT_TIMEOUT, 로그는 남고 반영된 것은 없다", async () => {
    const ctx = { supabase: user.client, userId: user.user.id };
    const before = (await user.client.from("tasks").select("id")).data!.length;
    const image = await fixture("create/01-single-task/01-military-email-excel-due-jan26.jpeg", "image/jpeg");

    const response = await runCapture(
      ctx,
      {
        mode: "create",
        image: { bytes: new Uint8Array(image.buffer), mimeType: image.mimeType },
        capturedAt: "2026-01-15T04:00:00.000Z",
        timezone: "Asia/Seoul",
      },
      AbortSignal.timeout(1),
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: { code: "AGENT_TIMEOUT", message: expect.any(String) },
    });
    expect((await user.client.from("tasks").select("id")).data!.length).toBe(before);

    const { data: logs } = await user.client
      .from("job_logs")
      .select("source, outcome, failure_reason, capture_summary, model")
      .eq("failure_reason", "AGENT_TIMEOUT");
    expect(logs).toEqual([
      { source: "capture_create", outcome: "failed", failure_reason: "AGENT_TIMEOUT", capture_summary: null, model: expect.stringMatching(/^(bedrock-)?gpt-/) },
    ]);
  });

  /**
   * 대시보드의 '오늘 마감' 판정이 이 값을 읽는다(`L-P0-11`). 1ms 신호로 **LLM을 타지 않으면서**
   * 실패 경로까지 한 번에 본다 — 갱신은 에이전트와 병렬로 돌고 캡처가 실패해도 남는다.
   */
  test("캡처가 계정 시간대를 갱신한다 — 실패해도", async () => {
    const ctx = { supabase: user.client, userId: user.user.id };
    const image = await fixture("create/01-single-task/01-military-email-excel-due-jan26.jpeg", "image/jpeg");

    const response = await runCapture(
      ctx,
      {
        mode: "create",
        image: { bytes: new Uint8Array(image.buffer), mimeType: image.mimeType },
        capturedAt: "2026-01-15T04:00:00.000Z",
        timezone: "Europe/Berlin",
      },
      AbortSignal.timeout(1),
    );

    expect(response.status).toBe(504);
    const { data: profile } = await user.client
      .from("profiles")
      .select("timezone")
      .eq("id", user.user.id)
      .single();
    expect(profile).toEqual({ timezone: "Europe/Berlin" });
  });
});
