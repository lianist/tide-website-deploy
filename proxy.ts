import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseEnv } from "@/lib/supabase/env";

/**
 * 브라우저 세션 쿠키를 갱신한다. **그것만 한다.**
 *
 * 인증 판단은 여기 없다 — `lib/supabase/session.ts`의 `requireUser()` 몫이다. 이유와, 이것이
 * "인증은 proxy가 아니라 핸들러 래퍼"라는 §설계 결정 9와 어떻게 공존하는지는
 * `docs/03-Architecture.md` §설계 결정 10에 있다. **지우기 전에 읽을 것.**
 *
 * 한 줄로 요약하면: Server Component는 쿠키를 쓸 수 없어서(Next 16 `cookies` 문서) 갱신된 토큰을
 * 저장할 자리가 요청 경계밖에 없다. 이 프로젝트는 리프레시 토큰 회전이 켜져 있어(`config.toml`의
 * `enable_refresh_token_rotation`) 갱신분을 못 쓰면 잠시 뒤 무작위 로그아웃이 난다.
 */
export async function proxy(request: NextRequest) {
  const { url, publishableKey } = supabaseEnv();
  const response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // 세션 쿠키가 실린 응답은 캐시되면 안 된다 — CDN이 한 사용자의 Set-Cookie를 다른
        // 사용자에게 서빙하게 된다. @supabase/ssr이 건네는 이 헤더가 그것을 막는다.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // 만료가 가까우면 여기서 갱신되고, 위 setAll이 새 토큰을 응답 쿠키에 쓴다.
  // 결과는 쓰지 않는다 — 누구인지 판정하는 것은 이 파일의 일이 아니다.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // `/api`는 제외한다. 앱이 쓰는 경로라 인증이 `Authorization: Bearer`로 오고(§설계 결정 9),
  // 쿠키 클라이언트를 돌릴 이유가 없다. 정적 자원도 세션과 무관하다.
  // `/`(랜딩, `(?!$)`)와 `/downloads`(설치 파일)도 뺀다 — 둘 다 로그인과 무관한 정적 파일이고,
  // 여기를 지나면 CDN이 캐시하지 못하는 응답이 될 수 있다(위 setAll의 캐시 헤더).
  matcher: ["/((?!$|api|_next/static|_next/image|favicon.ico|downloads/).*)"],
};
