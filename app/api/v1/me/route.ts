import { withAuth } from "@/lib/api/auth";
import { ok } from "@/lib/api/envelope";

/**
 * `GET /api/v1/me` — 토큰 검증과 계정 확인(`API-4`, `CAP-7`).
 *
 * 앱이 "지금 어느 계정으로 붙어 있는지"를 보여주고, 저장해 둔 토큰이 아직 쓸 만한지
 * 확인하는 데 쓴다. DB를 치지 않는다 — 답이 전부 검증된 토큰 안에 있다.
 */
/**
 * 개인정보처리방침 동의 전에도 연다(HF-06) — 토큰이 쓸 만한지 확인하는 자리라서, 동의 여부와 섞으면
 * 앱이 "토큰이 죽었다"와 "동의가 남았다"를 가르지 못한다. 동의는 다른 경로의 `403`이 알린다.
 */
export const GET = withAuth(
  async (_request, { userId, email }) => {
    return ok({ id: userId, email });
  },
  { requireConsent: false },
);
