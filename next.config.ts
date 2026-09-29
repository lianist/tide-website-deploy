import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `/`는 랜딩 페이지이면서 Supabase가 인증 흐름을 떨어뜨리는 자리다. 예전엔 `app/page.tsx`가
   * `searchParams`를 읽어 교통정리를 했는데, 그러면 랜딩이 요청마다 렌더되는 동적 페이지가 된다.
   * 여기서 먼저 보내면 `/`는 정적으로 남는다. 왜 이 둘이 `/`로 오는지는 `docs/03-Architecture.md`
   * §설계 결정 22와 `e2e/smoke.spec.ts`의 `/ 교통정리`.
   *
   * | 실려 오는 것 | 어디로 |
   * |---|---|
   * | `?code=` | `/auth/callback` — Next가 쿼리를 그대로 넘겨 `code`가 따라간다 |
   * | `?error=` | `/login?error=oauth_failed` — Google 실패 안내 |
   */
  async redirects() {
    return [
      /**
       * 옛 Framer 랜딩의 방침 주소(`tide-ai.framer.ai/policy`). 도메인을 옮긴 뒤에도 같은 경로로 오는
       * 링크(스토어 등록 정보 등)가 방침 하나(`/privacy` — 가입 때 동의받는 그 문서)에 닿게 한다.
       */
      { source: "/policy", destination: "/privacy", permanent: true },
      {
        source: "/",
        has: [{ type: "query", key: "code" }],
        destination: "/auth/callback",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "query", key: "error" }],
        destination: "/login?error=oauth_failed",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
