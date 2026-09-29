import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { readJsonObject } from "@/lib/api/input";
import { mergeTags } from "@/lib/api/tags";

/**
 * `POST /api/v1/tags/merge` — 태그 둘을 하나로 합친다(`DASH-6`, `API-6`).
 *
 * **`/tags/:id` 아래가 아니라 형제 경로다.** 합치는 일에는 주체가 둘이라 어느 한쪽을 경로에
 * 올리면 나머지 하나만 본문에 남아 대칭이 깨진다. 정적 세그먼트가 동적(`[id]`)보다 먼저 잡히므로
 * `merge`라는 id를 가진 태그와 부딪힐 일도 없다.
 *
 * `POST`인 것은 멱등하지 않아서다. 출발 태그가 이미 사라졌으므로 두 번째 호출은 `404`가 되고
 * 그것이 계약이다.
 *
 * 검증도 판정도 `lib/api/tags.ts`의 `mergeTags()` → DB 함수에 있다. 여기 남은 것은 봉투뿐이고,
 * `L-P1-06`의 태그 관리 패널이 같은 함수를 봉투 없이 부른다(`API-5`).
 */
export const POST = withAuth(async (request, { supabase }) => {
  const body = await readJsonObject(request);

  const result = await mergeTags(supabase, {
    sourceId: body?.sourceId,
    targetId: body?.targetId,
  });
  if (!result.ok) return fail(result.code, result.message);

  return ok(result.tag);
});
