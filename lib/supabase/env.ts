/**
 * Supabase 접속 정보 한 자리.
 *
 * 브라우저에도 실리는 publishable 키만 다룬다. RLS를 우회하는 `sb_secret_`은 여기 오지 않는다
 * (`docs/03-Architecture.md` §설계 결정 8 — 비밀 키는 Route Handler와 테스트 하네스를 벗어나지 않는다).
 */

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

/**
 * 없으면 즉시 던진다. 키가 빈 채로 돌면 "로그인이 안 된다"는 모양으로 한참 뒤에 드러나는데,
 * 그때는 원인이 환경변수라는 것이 보이지 않는다.
 */
export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다 (.env.example 참고).",
    );
  }
  return { url, publishableKey };
}
