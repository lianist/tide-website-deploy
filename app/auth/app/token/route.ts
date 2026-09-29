import type { AuthError, Session } from "@supabase/supabase-js";

import { fail, ok } from "@/lib/api/envelope";
import { nonEmptyString, readJsonObject } from "@/lib/api/input";
import { createStatelessSupabase, toAppSession } from "@/lib/auth/app-bridge";

/**
 * `POST /auth/app/token` — 앱이 세션을 받는 곳(`AUTH-3`). 갈래는 둘이고 응답 모양은 같다.
 *
 * | `grantType` | 함께 보내는 것 | 하는 일 |
 * |---|---|---|
 * | `code` | `code` (딥링크로 받은 값) | 일회용 코드를 풀어 앱 전용 새 세션을 연다 |
 * | `refreshToken` | `refreshToken` | 세션을 갱신한다 — 앱은 Supabase를 직접 부르지 않으므로(`API-1`) 여기를 지난다 |
 *
 * **`/api/v1` 밖에 둔다.** 저쪽은 "모든 엔드포인트가 Bearer를 요구한다, 예외 없음"이 계약이고, 이 경로는
 * 정의상 토큰이 아직 없거나 만료된 앱이 부른다(§설계 결정 18). 응답 봉투는 같은 것을 쓴다.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  const supabase = createStatelessSupabase();

  if (body?.grantType === "code") {
    const code = nonEmptyString(body.code);
    if (!code) return fail("VALIDATION_FAILED", "code가 필요합니다.");
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: code, type: "magiclink" });
    return respond(data.session, error);
  }

  if (body?.grantType === "refreshToken") {
    const refreshToken = nonEmptyString(body.refreshToken);
    if (!refreshToken) return fail("VALIDATION_FAILED", "refreshToken이 필요합니다.");
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    return respond(data.session, error);
  }

  return fail("VALIDATION_FAILED", "grantType은 code 또는 refreshToken이어야 합니다.");
}

/**
 * 잘못됐거나 만료됐거나 이미 쓴 코드·토큰은 전부 같은 `401`이다 — 어느 쪽인지 알려 줄 이유가 없고,
 * 앱은 어느 경우든 로그인 화면을 띄우면 된다. Auth 서버 자체가 실패한 것(5xx·네트워크)만 `500`으로 가른다.
 * 그걸 401로 합치면 앱이 멀쩡한 사용자를 로그아웃시킨다.
 */
function respond(session: Session | null, error: AuthError | null): Response {
  if (session) return ok(toAppSession(session));

  const rejected = error?.status !== undefined && error.status >= 400 && error.status < 500;
  if (!rejected) {
    console.error("[auth/app/token] Auth 서버 실패:", error?.code, error?.message);
    return fail("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");
  }
  return fail("UNAUTHORIZED", "다시 로그인해 주세요.");
}
