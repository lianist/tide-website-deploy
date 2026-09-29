import { withAuth } from "@/lib/api/auth";
import { CAPTURE_BUDGET_MS, parseCaptureForm, runCapture } from "@/lib/api/captures";
import { fail } from "@/lib/api/envelope";

/**
 * `POST /api/v1/captures` — 캡처 한 장을 받아 태스크를 만들거나 완료한다(`API-3`).
 *
 * 10초는 **요청이 들어온 순간**부터 잰다(`AGT-9`). 본문을 읽고 검증하는 시간도 예산 안이다.
 */

/**
 * 플랫폼 상한은 우리 예산(10초)보다 **길게** 잡는다.
 *
 * 같거나 짧으면 Vercel이 먼저 함수를 죽여 봉투 밖의 504가 나가고 `AGENT_TIMEOUT` 로그도 남지
 * 않는다. 20초면 위의 `AbortSignal`이 항상 먼저 밟혀 계약이 지켜진다. Vercel 기본값은 fluid
 * compute 기준 300초라, 이 값은 상한을 늘리는 것이 아니라 폭주를 막으려고 **줄이는** 쪽이다.
 */
export const maxDuration = 20;

export const POST = withAuth(async (request, ctx) => {
  const signal = AbortSignal.timeout(CAPTURE_BUDGET_MS);

  const parsed = await parseCaptureForm(request);
  if (!parsed.ok) return fail("VALIDATION_FAILED", parsed.message);

  return runCapture(ctx, parsed.request, signal);
});
