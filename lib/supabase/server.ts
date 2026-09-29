import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabaseEnv } from "./env";
import type { Database } from "./database.types";

/**
 * 브라우저 세션을 읽는 서버 클라이언트 — 웹 화면과 Server Action이 쓴다.
 *
 * **앱이 쓰는 `lib/api/auth.ts`의 `withAuth`와 층이 다르다.** 저쪽은 요청이 들고 온
 * `Authorization: Bearer` 한 장이 전부인 무상태 경로고, 이쪽은 쿠키에 담긴 세션이다. 둘은 공존하며
 * 서로를 대체하지 않는다(`docs/04-API-Contract.md` §인증).
 *
 * 공통점은 하나 — **돌려주는 클라이언트가 요청자 토큰을 달고 있어 모든 쿼리가 RLS 아래에서 돈다.**
 * 그래서 화면 코드도 소유권을 직접 비교하지 않는다.
 */
export async function createServerSupabase(): Promise<SupabaseClient<Database>> {
  const { url, publishableKey } = supabaseEnv();
  const store = await cookies();

  // 요청마다 새로 만든다. 모듈 스코프에 캐시하면 한 사용자의 세션이 다음 요청으로 새어 나간다.
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server Component 렌더 중에는 쿠키를 쓸 수 없다(Next 16 `cookies` 문서 — 스트리밍이
          // 시작된 뒤에는 Set-Cookie를 붙일 수 없기 때문이다). 토큰 갱신 쓰기는 `proxy.ts`가
          // 맡으므로 여기서 실패하는 것은 정상이고, 삼켜도 세션이 유실되지 않는다.
        }
      },
    },
  });
}
