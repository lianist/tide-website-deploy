import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * 앱 로그인 딥링크 브리지(`AUTH-3`) — 계약은 `docs/04-API-Contract.md` §앱 로그인,
 * 이유는 `docs/03-Architecture.md` §설계 결정 18.
 */

/**
 * 인증을 마친 브라우저를 보낼 수 있는 곳. **문자열 완전 일치**로만 비교한다 — 접두어로 비교하면
 * `dochi://auth/callback.evil`처럼 뒤에 덧붙인 주소가 통과한다. 늘리려면 계약 문서와 함께 고친다.
 */
export const APP_REDIRECT_URIS: readonly string[] = ["dochi://auth/callback"];

export function isAllowedAppRedirect(value: string | null): value is string {
  return value !== null && APP_REDIRECT_URIS.includes(value);
}

/**
 * 세션을 들지 않는 클라이언트 — 코드 교환·갱신이 돌려준 세션을 **저장하지 않고 앱에 그대로 넘긴다.**
 * 쿠키 클라이언트(`lib/supabase/server.ts`)를 쓰면 앱의 세션이 이 브라우저의 쿠키에 덮어써진다.
 */
export function createStatelessSupabase(): SupabaseClient<Database> {
  const { url, publishableKey } = supabaseEnv();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 앱에 건네는 세션. 토큰 엔드포인트의 두 갈래(코드 교환·갱신)가 같은 모양을 돌려준다. */
export function toAppSession(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    // 초 단위 유닉스 시각이 아니라 계약의 다른 시각들처럼 ISO 8601 UTC로 준다.
    expiresAt: new Date((session.expires_at ?? 0) * 1000).toISOString(),
    user: { id: session.user.id, email: session.user.email ?? null },
  };
}

/**
 * 이 사용자로 새 세션을 열 일회용 코드 — 딥링크(`/auth/app/start`)와 웹뷰 이어주기(`/api/v1/web-session`)가 함께 쓴다.
 *
 * magiclink의 `hashed_token`을 코드로 쓴다 — 관리자 API가 **메일을 보내지 않고** 만들어 주고, 일회용이며
 * `otp_expiry`(1시간)에 만료된다. `verifyOtp`로 풀면 다른 세션과 무관한 새 세션이 선다.
 * **새로 발급하면 이전 코드는 무효가 된다** — 부르는 쪽이 순서를 지킨다(계약 §앱 로그인).
 */
export async function issueCode(email: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data.properties) {
    console.error("[app-bridge] 코드 발급 실패:", error?.code, error?.message);
    return null;
  }
  return data.properties.hashed_token;
}
