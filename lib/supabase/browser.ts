import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseEnv } from "./env";
import type { Database } from "./database.types";

/**
 * 브라우저가 쓰는 Supabase 클라이언트 — 지금 쓰는 곳은 대시보드의 Realtime 구독 하나뿐이다.
 *
 * 앱은 Supabase를 직접 부르지 않지만(`API-1`) **브라우저 대시보드는 Dochi 자신이라 예외다**
 * (`docs/03-Architecture.md` §설계 결정 3). 실리는 것은 `sb_publishable_` 키뿐이고 읽을 수 있는
 * 범위는 RLS가 `auth.uid()`로 막는다. 구현의 근거는 같은 문서 §설계 결정 21.
 *
 * **`server.ts`와 규칙이 정반대다.** 저쪽은 "요청마다 새로 만든다" — 한 프로세스가 여러 사용자의
 * 세션을 다루기 때문이다. 여기는 한 탭에 사용자가 한 명뿐이고, `createBrowserClient`가 브라우저에서
 * **이미 모듈 스코프에 캐시한다**(`@supabase/ssr`). 그 위에 캐시를 또 얹지 않는다.
 *
 * 🔑 **쓰기에 쓰지 않는다.** 브라우저의 쓰기는 Server Action을 지난다(§설계 결정 20).
 */
export function createBrowserSupabase(): SupabaseClient<Database> {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
