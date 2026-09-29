import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { readJsonObject } from "@/lib/api/input";
import { createTag, TAG_COLUMNS, toTagPayload } from "@/lib/api/tags";

/** `GET /api/v1/tags` — 태그 목록(`API-2`). 이름순. */
export const GET = withAuth(async (_request, { supabase }) => {
  const { data, error } = await supabase.from("tags").select(TAG_COLUMNS).order("name");

  if (error) return fail("INTERNAL_ERROR", "태그 목록을 불러오지 못했습니다.");
  return ok(data.map(toTagPayload));
});

/** `POST /api/v1/tags` — 태그 생성. 같은 이름이 이미 있으면 `409 TAG_NAME_TAKEN`. */
export const POST = withAuth(async (request, { supabase, userId }) => {
  const body = await readJsonObject(request);
  const result = await createTag(supabase, userId, body?.name);

  if (!result.ok) return fail(result.code, result.message);
  return ok(result.tag);
});
