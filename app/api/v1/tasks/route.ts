import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { isUuid, readJsonObject } from "@/lib/api/input";
import { insertTask, listTasks, parseTaskFields, toTaskPayload } from "@/lib/api/tasks";

/**
 * `GET /api/v1/tasks` — 태스크 목록(`API-2`). `status`·`tagId`로 거른다.
 *
 * 쿼리 조립과 `DASH-1` 정렬은 `listTasks`에 있다 — 대시보드 화면이 같은 것을 쓴다.
 */
export const GET = withAuth(async (request, { supabase }) => {
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const tagId = params.get("tagId");

  if (status !== null && status !== "todo" && status !== "done") {
    return fail("VALIDATION_FAILED", "상태는 todo 또는 done이어야 합니다.");
  }
  if (tagId !== null && !isUuid(tagId)) {
    return fail("VALIDATION_FAILED", "태그 형식이 올바르지 않습니다.");
  }

  const { data, error } = await listTasks(supabase, {
    status: status ?? undefined,
    tagId: tagId ?? undefined,
  });

  if (error) return fail("INTERNAL_ERROR", "태스크 목록을 불러오지 못했습니다.");
  return ok(data.map(toTaskPayload));
});

/**
 * `POST /api/v1/tasks` — 사용자가 직접 만드는 태스크(`API-2`, `DASH-4`). 생성 경로는 항상 `manual`.
 *
 * 쓰기의 알맹이는 `insertTask`에 있다 — 대시보드의 Server Action이 같은 함수를 부른다.
 */
export const POST = withAuth(async (request, { supabase }) => {
  const body = await readJsonObject(request);
  if (!body) return fail("VALIDATION_FAILED", "요청 본문이 올바르지 않습니다.");

  const parsed = parseTaskFields(body, "create");
  if (!parsed.ok) return fail("VALIDATION_FAILED", parsed.message);

  const result = await insertTask(supabase, parsed.fields);
  if (!result.ok) return fail(result.code, result.message);

  return ok(result.task);
});
