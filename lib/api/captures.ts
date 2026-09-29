import { runCompleteAgent } from "@/lib/agent/complete";
import { runCreateAgent, type CreateAgentInput } from "@/lib/agent/create";
import { LlmError } from "@/lib/llm";

import type { AuthContext } from "./auth";
import { fail, ok } from "./envelope";
import { recordJobLog } from "./job-logs";

/**
 * 캡처 API(`API-3`)의 본체 — `docs/04-API-Contract.md` §캡처.
 *
 * 라우트(`app/api/v1/captures/route.ts`)는 신호를 만들고 이 두 함수를 잇기만 한다. 본체를 라우트
 * 밖에 둔 것은 테스트가 HTTP 없이 짧은 신호로 타임아웃 경로를 결정적으로 밟기 위해서다.
 */

/** 캡처 수신부터 결과 반영까지(`AGT-9`). 신호는 LLM 호출에만 걸린다 — 이유는 `runCapture`. */
export const CAPTURE_BUDGET_MS = 10_000;

/**
 * Vercel 함수의 요청 본문 한도(4.5MB)보다 조금 아래. 한도에 걸리면 플랫폼이 봉투 밖의 413을
 * 내므로 우리가 먼저 400으로 막는다. 모델이 어차피 긴 변 2048px로 줄이므로 앱은 줄여서 보낸다.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** OpenAI vision이 받는 형식 중 캡처에서 나올 만한 것. 움직이는 GIF는 받지 않는다. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type CaptureMode = "create" | "complete";

export type CaptureRequest = Omit<CreateAgentInput, "signal"> & { mode: CaptureMode };

type Parsed = { ok: true; request: CaptureRequest } | { ok: false; message: string };

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** multipart 네 칸을 검증한다. 실패는 전부 `VALIDATION_FAILED` 하나로 모이므로 문장만 돌려준다. */
export async function parseCaptureForm(request: Request): Promise<Parsed> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, message: "캡처는 multipart/form-data로 보내야 합니다." };
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return { ok: false, message: "캡처 이미지가 없습니다." };
  }
  if (!IMAGE_TYPES.has(image.type)) {
    return { ok: false, message: "캡처 이미지는 PNG·JPEG·WebP여야 합니다." };
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: "캡처 이미지가 너무 큽니다 (4MB 이하)." };
  }

  const mode = form.get("mode");
  if (mode !== "create" && mode !== "complete") {
    return { ok: false, message: "모드는 create 또는 complete여야 합니다." };
  }

  const capturedAt = form.get("capturedAt");
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) {
    return { ok: false, message: "캡처 시각 형식이 올바르지 않습니다." };
  }

  const timezone = form.get("timezone");
  if (typeof timezone !== "string" || !isTimeZone(timezone)) {
    return { ok: false, message: "시간대 형식이 올바르지 않습니다." };
  }

  return {
    ok: true,
    request: {
      mode,
      // 바이트는 에이전트에만 건너가고 어디에도 쓰이지 않는다(`AGT-10`).
      image: { bytes: new Uint8Array(await image.arrayBuffer()), mimeType: image.type },
      capturedAt: new Date(capturedAt).toISOString(),
      timezone,
    },
  };
}

/**
 * `mode`로 에이전트를 고르고, 에이전트가 쓰지 못한 실패의 작업 로그를 쓴다(`AGT-8`).
 *
 * **`signal`은 LLM 호출에만 닿는다.** 요청 전체를 경주로 자르면 응답은 504인데 뒤에서 태스크가
 * 만들어질 수 있다. LLM이 끝나기 전에는 아무것도 반영되지 않으므로, 거기서 끊으면 "504면 반영된
 * 것이 없다"가 성립한다(`docs/03-Architecture.md` §설계 결정 17).
 *
 * 타임아웃·LLM 오류의 로그에는 `capture_summary`가 없다 — 요약은 LLM 출력에서만 나온다.
 */
export async function runCapture(
  ctx: Pick<AuthContext, "supabase" | "userId">,
  { mode, ...input }: CaptureRequest,
  signal: AbortSignal,
): Promise<Response> {
  const source = mode === "create" ? "capture_create" : "capture_complete";

  // 계정 시간대를 앱이 보낸 값으로 맞춘다(`L-P0-11`). 대시보드의 '오늘 마감' 판정과 날짜 표시가
  // 이 값을 읽는다 — 서버(Vercel)는 UTC라 서버 시간대를 쓰면 틀린다.
  //
  // **await 하지 않고 띄운다.** 에이전트 호출과 겹쳐 돌아 10초 예산(`AGT-9`)에 왕복이 더해지지
  // 않는다. `try` 밖인 것은 `catch`도 이 변수를 봐야 하기 때문이고, 두 인자 `then`인 것은
  // Supabase 빌더가 `PromiseLike`라 `.catch`를 가정하지 않기 때문이다 — 동시에 이 호출이 빌더를
  // **실제로 보내는** 지점이다(빌더는 `then`이 불릴 때 나간다).
  const timezoneUpdate = ctx.supabase
    .from("profiles")
    .update({ timezone: input.timezone })
    .eq("id", ctx.userId)
    .then(
      () => undefined,
      () => undefined,
    );

  try {
    const agent = mode === "create" ? runCreateAgent : runCompleteAgent;
    return ok(await agent(ctx, { ...input, signal }));
  } catch (error) {
    if (!(error instanceof LlmError)) {
      // LLM 뒤의 DB 오류. DB가 응답하지 않는 상황이라 로그도 쓰지 않는다(생성은 이미 로그가 있다).
      // 원인 객체를 통째로 찍지 않는다 — 요청 본문이 딸려 나갈 여지를 두지 않는다(`AGT-10`).
      const { code, message } = error as { code?: string; message?: string };
      console.error("[captures] 반영 실패:", code, message);
      return fail("INTERNAL_ERROR", "캡처를 처리하지 못했어요.");
    }

    const code = error.aborted ? "AGENT_TIMEOUT" : "INTERNAL_ERROR";
    try {
      await recordJobLog(ctx, { source, outcome: "failed", failureReason: code, usage: error.usage });
    } catch {
      // 로그를 못 써도 앱에는 원래 실패를 알린다.
    }
    if (error.aborted) return fail("AGENT_TIMEOUT", "처리 시간이 초과되었어요.");
    console.error("[captures] LLM 실패:", error.message);
    return fail("INTERNAL_ERROR", "캡처를 처리하지 못했어요.");
  } finally {
    // 응답 직전에 거둔다. 서버리스 함수는 응답을 낸 뒤의 실행을 보장하지 않아, 기다리지 않으면
    // 갱신이 조용히 사라진다 — 로컬 dev에서는 성공하고 프로덕션에서만 새는 종류의 버그다.
    // 여기서는 이미 에이전트 시간만큼 지난 뒤라 사실상 0ms고, 네 개 return 경로를 한 줄로 덮는다.
    // 실패는 위에서 삼켰다 — 시간대 갱신이 캡처 결과를 뒤집지 않는다.
    await timezoneUpdate;
  }
}
