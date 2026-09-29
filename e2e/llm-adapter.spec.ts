import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { ESLint } from "eslint";

import { recordJobLog } from "@/lib/api/job-logs";
import { analyzeImage, LlmError, type LlmUsage } from "@/lib/llm";

import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-07 검증 — LLM 어댑터 choke point(`docs/03-Architecture.md` §설계 결정 4).
 *
 * 넷을 본다: 경계가 린트로 강제되는지, 실제 호출이 구조화 출력과 계측값을 돌려주는지, 그 계측값이
 * `job_logs`에 손실 없이 앉는지, 호출부가 끊어도 계측이 남는지.
 *
 * ⚠️ 두 번째 테스트는 **실제 OpenAI를 부른다**(Luna, 캡처 1장 ≈ $0.002). 브라우저는 쓰지 않는다.
 */
test.describe.configure({ mode: "serial" });

const CAPTURE = "e2e/fixtures/captures/create/01-single-task/01-military-email-excel-due-jan26.jpeg";

/** 어댑터 검증용 최소 스키마. 에이전트의 진짜 스키마는 L-P0-08에서 정한다. */
const SUMMARY_SCHEMA = {
  name: "capture_summary",
  jsonSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false,
  },
};

async function captureRequest(signal?: AbortSignal) {
  return {
    system: "당신은 화면 캡처를 읽고 무엇이 보이는지 한국어 한 문장으로 요약하는 분석기다.",
    prompt: "이 캡처를 한 문장으로 요약하라.",
    image: { bytes: await readFile(CAPTURE), mimeType: "image/jpeg" },
    schema: SUMMARY_SCHEMA,
    signal,
  };
}

test.describe("LLM 어댑터", () => {
  let admin: DochiClient;
  let user: TestUser;
  let usage: LlmUsage;

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.user.id);
  });

  test("lib/llm 밖에서 openai를 import하면 린트가 실패한다", async () => {
    const eslint = new ESLint();
    const restricted = async (code: string, filePath: string) => {
      const results = await eslint.lintText(code, { filePath });
      return results.flatMap((r) => r.messages).filter((m) => m.ruleId === "no-restricted-imports");
    };

    const direct = 'import OpenAI from "openai";\nexport const c = OpenAI;\n';
    const subpath = 'import { zodTextFormat } from "openai/helpers/zod";\nexport const f = zodTextFormat;\n';

    for (const filePath of ["app/api/v1/captures/route.ts", "lib/api/job-logs.ts", "e2e/x.spec.ts"]) {
      const messages = await restricted(direct, filePath);
      // severity 2 = error. warn이면 --max-warnings=0에 기대게 되는데, 경계는 그보다 단단해야 한다.
      expect(messages.map((m) => m.severity), filePath).toEqual([2]);
    }
    expect(await restricted(subpath, "lib/agent/create.ts")).toHaveLength(1);

    // 경계 안쪽은 허용된다. 규칙이 과하게 걸려 어댑터 자신을 막으면 안 된다.
    expect(await restricted(direct, "lib/llm/openai.ts")).toHaveLength(0);
  });

  test("실제 호출이 스키마대로 된 출력과 계측값을 돌려준다", async () => {
    const result = await analyzeImage<{ summary: string }>(await captureRequest());

    expect(Object.keys(result.output)).toEqual(["summary"]);
    expect(result.output.summary.trim().length).toBeGreaterThan(0);

    usage = result.usage;
    // 응답에 적힌 ID는 스냅샷 접미사가 붙을 수 있다.
    expect(usage.model).toMatch(/^(bedrock-)?gpt-5\.6-/);
    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(usage.latencyMs).toBeGreaterThan(0);
    // 10초 예산(AGT-9)은 에이전트 전체의 것이지만, 호출 하나가 이미 넘기면 설계를 다시 봐야 한다.
    expect(usage.latencyMs).toBeLessThan(10_000);

    console.log("LLM 실측", JSON.stringify({ ...usage, summary: result.output.summary }));
  });

  test("계측값이 job_logs 한 행에 그대로 앉는다", async () => {
    const id = await recordJobLog(
      { supabase: user.client, userId: user.user.id },
      { source: "capture_create", outcome: "created", captureSummary: "어댑터 검증", usage },
    );

    const { data, error } = await user.client
      .from("job_logs")
      .select("user_id, model, prompt_tokens, completion_tokens, latency_ms")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      user_id: user.user.id,
      model: usage.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      latency_ms: usage.latencyMs,
    });
  });

  test("호출부가 끊으면 LlmError가 계측을 들고 나온다", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await analyzeImage(await captureRequest(controller.signal)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    const { aborted, usage: failed } = error as LlmError;
    expect(aborted).toBe(true);
    // 응답을 받지 못했으니 토큰은 모른다 — 그래도 모델과 지연은 남아 job_logs에 쓸 수 있다.
    // 게이트웨이 키 유무로 OpenAI 직결(gpt-5.6-luna)과 게이트웨이(bedrock-gpt-5.6-sol)가 갈린다.
    expect(failed.model).toMatch(/^(bedrock-)?gpt-5\.6-/);
    expect(failed.promptTokens).toBeNull();
    expect(failed.completionTokens).toBeNull();
    expect(failed.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
