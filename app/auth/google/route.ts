import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/auth/next";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * `GET /auth/google` — Google 동의 화면으로 보낸다.
 *
 * Server Action이 아니라 Route Handler인 이유 둘: 바깥 도메인으로 나가는 이동이라 평범한 링크
 * (`<a href>`)로 여는 편이 뻔하고, `request.url`에서 돌아올 주소를 바로 얻을 수 있어 사이트 주소를
 * 환경변수로 따로 둘 필요가 없다.
 *
 * `?next=`를 받아 콜백까지 운반한다 — 앱 딥링크(`/auth/app/start`)가 로그인 뒤 돌아올 자리다.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const supabase = await createServerSupabase();
  const { origin, searchParams } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  // 프로바이더가 꺼져 있거나 키가 없으면 여기서 걸린다. 사용자에게는 로그인 화면에서 알린다.
  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  }

  return NextResponse.redirect(data.url);
}
