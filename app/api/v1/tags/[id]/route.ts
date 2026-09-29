import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { readJsonObject } from "@/lib/api/input";
import { removeTag, renameTag } from "@/lib/api/tags";

/**
 * `/api/v1/tags/:id` — 태그 이름 변경·삭제(`API-2`). 병합은 `/api/v1/tags/merge`에 있다.
 *
 * **알맹이는 여기 없다.** `lib/api/tags.ts`의 `renameTag`·`removeTag`를 웹의 태그 관리 패널
 * (`L-P1-06`)과 나눠 쓴다(`API-5`, 설계 결정 20). 여기 남은 일은 본문을 꺼내 봉투에 담는 것뿐이고,
 * **`reason` 칸은 읽지 않는다** — 그건 화면이 `?error=`에 실을 토큰이다.
 */
type Context = RouteContext<"/api/v1/tags/[id]">;

export const PATCH = withAuth<Context>(async (request, { supabase, params }) => {
  const { id } = await params;
  const body = await readJsonObject(request);

  const result = await renameTag(supabase, id, body?.name);
  if (!result.ok) return fail(result.code, result.message);

  return ok(result.tag);
});

export const DELETE = withAuth<Context>(async (_request, { supabase, params }) => {
  const { id } = await params;

  const result = await removeTag(supabase, id);
  if (!result.ok) return fail(result.code, result.message);

  return ok({ id: result.id });
});
