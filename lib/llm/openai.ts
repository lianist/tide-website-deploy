import OpenAI from "openai";

import {
  LlmError,
  type AnalyzeImageRequest,
  type AnalyzeImageResult,
  type LlmUsage,
} from "./types";

/**
 * OpenAI 구현 — 저장소에서 `openai`를 import 하는 **유일한 파일**이다(`eslint.config.mjs`가 강제).
 * 아래 상수들의 근거·가격·실측은 `docs/03-Architecture.md` §설계 결정 4. **바꾸기 전에 읽을 것.**
 */

/**
 * OpenAI 직결 모델 — 비용 최적 등급. `gpt-5.6-terra`로 올려 봤지만 L-P0-08 평가 세트에서 태그 해석이
 * 흔들려 오히려 떨어졌다 — 올리기 전에 `npm run grade`로 다시 비교할 것.
 */
const OPENAI_MODEL = "gpt-5.6-luna";

/**
 * 본부 지원 게이트웨이(AWS Bedrock, OpenAI 호환) 쪽 모델. 우리 키로 승인된 별칭은 이것과 Claude 하나뿐이고
 * Luna는 없다. Claude 별칭은 Responses API의 `json_schema`를 무시하고 평문을 돌려줘 쓰지 않는다.
 */
const GATEWAY_MODEL = "bedrock-gpt-5.6-sol";

/** 호출당 비용 상한의 출력 쪽 절반. 추론 토큰도 여기 포함된다. */
const MAX_OUTPUT_TOKENS = 2000;

let provider: { client: OpenAI; model: string } | null = null;

/**
 * 게이트웨이 키가 있으면 게이트웨이로, 없으면 OpenAI로 직접 보낸다 — env만 빼면 롤백이다.
 * 키가 없으면 첫 호출에서 던진다 — 모듈 로드 시점에 읽으면 `next build`가 env 없이 죽는다.
 */
function openai(): { client: OpenAI; model: string } {
  if (provider) return provider;

  // SDK 기본값은 실패 시 2회 재시도다. 재시도가 붙으면 한 번의 느린 호출이 10초 예산(AGT-9)을
  // 통째로 먹으므로 끈다. 시간 제한은 호출부의 AbortSignal 하나로만 건다.
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY;
  if (gatewayKey) {
    const baseURL = process.env.LLM_GATEWAY_URL;
    if (!baseURL) throw new Error("LLM_GATEWAY_URL이 필요합니다 (.env.example 참고).");
    provider = { client: new OpenAI({ apiKey: gatewayKey, baseURL, maxRetries: 0 }), model: GATEWAY_MODEL };
    return provider;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 필요합니다 (.env.example 참고).");
  provider = { client: new OpenAI({ apiKey, maxRetries: 0 }), model: OPENAI_MODEL };
  return provider;
}

export async function analyzeImage<T>(
  request: AnalyzeImageRequest,
): Promise<AnalyzeImageResult<T>> {
  const { system, prompt, image, schema, signal } = request;
  const dataUrl = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;

  const { client, model } = openai();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let response: OpenAI.Responses.Response;
  try {
    response = await client.responses.create(
      {
        model,
        // 기본값 true는 응답을 OpenAI 쪽에 30일 보관한다. 캡처 무저장(AGT-10)은 우리 저장소만의
        // 이야기가 아니므로 끈다. 대화를 이어 가지 않으니 잃는 것도 없다.
        store: false,
        // 기본값 medium은 10초 예산에 비해 느리다. L-P0-08 평가 세트에서 medium은 품질이 오르지 않고
        // 지연 꼬리만 늘었다(ROADMAP L-P0-08 실험표).
        reasoning: { effort: "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: system,
        input: [
          {
            role: "user",
            content: [
              // high는 2048px·2,500패치(≈3,000토큰)에서 잘린다 — 비용 상한의 입력 쪽 절반이다.
              { type: "input_image", image_url: dataUrl, detail: "high" },
              { type: "input_text", text: prompt },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: schema.name,
            schema: schema.jsonSchema,
            strict: true,
          },
        },
      },
      { signal },
    );
  } catch (error) {
    const aborted = signal?.aborted ?? false;
    const usage: LlmUsage = {
      model,
      promptTokens: null,
      completionTokens: null,
      latencyMs: elapsed(),
    };
    // 원본 메시지 대신 고정 문구를 쓰고 원인은 cause로만 넘긴다. 이 메시지가 로그로 흘러가도
    // 요청 본문(base64 이미지)이 딸려 나갈 여지를 두지 않는다.
    throw new LlmError(
      aborted ? "LLM 호출이 중단되었습니다." : "LLM 호출에 실패했습니다.",
      usage,
      { aborted, cause: error },
    );
  }

  const usage: LlmUsage = {
    model: response.model,
    promptTokens: response.usage?.input_tokens ?? null,
    completionTokens: response.usage?.output_tokens ?? null,
    latencyMs: elapsed(),
  };

  // incomplete = 출력 상한에 걸려 JSON이 중간에 끊겼다. 거부(refusal)는 output_text가 비어 온다.
  if (response.status !== "completed" || !response.output_text) {
    throw new LlmError(`LLM 응답이 완결되지 않았습니다 (status=${response.status}).`, usage);
  }

  try {
    return { output: JSON.parse(response.output_text) as T, usage };
  } catch (error) {
    throw new LlmError("LLM 응답이 스키마 JSON이 아닙니다.", usage, { cause: error });
  }
}
