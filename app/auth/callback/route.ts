import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNext } from "@/lib/auth/next";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * `GET /auth/callback` — 바깥에서 돌아온 사용자의 세션을 세운다.
 *
 * 들어오는 길이 둘이고, 둘 다 "세션을 세우고 `next`로 보낸다"는 같은 모양이라 한 파일에 둔다.
 *
 * | 무엇이 실려 오나 | 어디서 | 어떻게 푸나 |
 * |---|---|---|
 * | `code` | Google OAuth | `exchangeCodeForSession` |
 * | `token_hash` + `type` | 가입 확인·비밀번호 재설정 메일 | `verifyOtp` |
 *
 * **메일 링크에 `code`가 아니라 `token_hash`를 쓰는 이유**: `code` 방식은 링크를 연 브라우저에
 * 검증용 쿠키가 남아 있어야 한다. 컴퓨터에서 가입하고 폰에서 메일을 열면 그 쿠키가 없어 깨진다.
 * `token_hash`는 그 제약이 없다. 메일 템플릿이 이 형식으로 링크를 만든다(§설계 결정 12).
 */

/** 메일 링크로 들어올 수 있는 종류만 통과시킨다. 쿼리는 사용자가 고칠 수 있는 값이다. */
const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["signup", "recovery", "email", "invite", "magiclink", "email_change"]);

function emailOtpType(value: string | null): EmailOtpType | null {
  return value && EMAIL_OTP_TYPES.has(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const { origin, searchParams } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));

  /**
   * **실패는 쿼리로 먼저 온다.** OAuth 제공자와 Supabase는 잘못됐을 때 `code` 대신
   * `?error=…&error_description=…`을 붙여 돌려보낸다. 이걸 먼저 보지 않으면 "실려 온 것이
   * 없다"는 마지막 분기로 떨어져 **만료됐다는 엉뚱한 안내**를 하게 된다 — 원인이 화면에서
   * 사라지므로 진단이 어려워진다.
   */
  const providerError = searchParams.get("error");
  if (providerError) {
    console.error(
      "[auth/callback] 인증 제공자가 실패를 알렸다:",
      providerError,
      searchParams.get("error_code"),
      searchParams.get("error_description"),
    );
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  }

  const supabase = await createServerSupabase();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // 원인이 여럿이라(검증 쿠키 없음·코드 재사용·설정 오류) 화면 문구만으로는 좁힐 수 없다.
      console.error("[auth/callback] 코드 교환 실패:", error.code, error.message);
      return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  const tokenHash = searchParams.get("token_hash");
  const type = emailOtpType(searchParams.get("type"));
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error("[auth/callback] 메일 링크 검증 실패:", error.code, error.message);
      return NextResponse.redirect(new URL("/login?error=link_expired", origin));
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  // 아무것도 안 실려 왔다 — 링크를 손으로 자른 경우다. 만료와 같은 화면으로 합류시킨다.
  return NextResponse.redirect(new URL("/login?error=link_expired", origin));
}
