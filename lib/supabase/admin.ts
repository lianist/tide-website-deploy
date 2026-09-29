import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * RLS를 우회하는 관리자 클라이언트 — `sb_secret_` 키를 쓴다.
 *
 * ⚠️ **브라우저 번들에 닿는 곳에서 import하지 않는다**(`docs/03-Architecture.md` §설계 결정 8).
 * 경계는 파일 종류가 아니라 번들이다 — 이 주석이 한때 "Route Handler에서만"이라고 적혀 있었는데
 * 그때 유일한 사용처는 Route Handler가 아니라 서버 컴포넌트였다. 목록으로 적으면 이렇게 진다.
 *
 * 지금 쓰는 곳은 둘이다(테스트 하네스 제외):
 * - 앱 딥링크 브리지(`app/auth/app/start`) — 앱에 줄 일회용 코드 발급(§설계 결정 18)
 * - 회원 탈퇴 Server Action(`app/(app)/settings/actions.ts`) — 요청자 **자신의** `auth.users` 한 행 삭제
 *
 * 🔴 **남의 데이터를 이 키로 읽거나 쓰지 않는다.** 위 둘 다 대상이 요청자 자신으로 고정돼 있다.
 * 데이터를 읽고 쓰는 것은 언제나 요청자 토큰을 단 클라이언트(RLS)의 몫이다.
 */
export function createAdminSupabase(): SupabaseClient<Database> {
  const { url } = supabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY가 필요합니다 (.env.example 참고).");
  }
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
