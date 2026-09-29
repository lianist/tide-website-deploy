import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { readJsonObject } from "@/lib/api/input";
import {
  INVALID_UUID,
  parseTaskFields,
  patchTask,
  removeTask,
  selectTask,
  TASK_NOT_FOUND_MESSAGE,
  toTaskPayload,
} from "@/lib/api/tasks";

/**
 * `/api/v1/tasks/:id` — 태스크 단건 조회·수정·삭제(`API-2`).
 *
 * 소유권을 비교하는 코드가 없는 것이 의도다. `withAuth`가 건네는 클라이언트는 요청자의
 * 토큰을 달고 있어 RLS가 남의 행을 애초에 보여 주지 않는다. 비교하지 않으니 빠뜨릴 수도 없다.
 * 그래서 남의 태스크는 "0행"으로 돌아오고, 없는 태스크와 같은 404로 합류한다.
 *
 * `:id`가 UUID 꼴이 아니면(22P02) 이것도 404다. 앱은 자기가 받은 id만 쓰므로 실질적으로
 * "없는 태스크"이고, 분기를 하나 줄이는 편이 낫다.
 *
 * **쓰기의 알맹이는 `lib/api/tasks.ts`에 있다** — 대시보드의 Server Action이 같은 함수를 부른다.
 * 여기 남은 것은 본문 파싱과 봉투뿐이다.
 */
type Context = RouteContext<"/api/v1/tasks/[id]">;

export const GET = withAuth<Context>(async (_request, { supabase, params }) => {
  const { id } = await params;

  const { data, error } = await selectTask(supabase, id);
  if (error) {
    if (error.code === INVALID_UUID) return fail("TASK_NOT_FOUND", TASK_NOT_FOUND_MESSAGE);
    return fail("INTERNAL_ERROR", "태스크를 불러오지 못했습니다.");
  }
  if (!data) return fail("TASK_NOT_FOUND", TASK_NOT_FOUND_MESSAGE);

  return ok(toTaskPayload(data));
});

/** 제목·설명·마감일·상태·태그를 고친다. 상태 전환(`todo` ↔ `done`)도 이 경로다. */
export const PATCH = withAuth<Context>(async (request, { supabase, params }) => {
  const { id } = await params;

  const body = await readJsonObject(request);
  if (!body) return fail("VALIDATION_FAILED", "요청 본문이 올바르지 않습니다.");

  const parsed = parseTaskFields(body, "update");
  if (!parsed.ok) return fail("VALIDATION_FAILED", parsed.message);

  const result = await patchTask(supabase, id, parsed.fields);
  if (!result.ok) return fail(result.code, result.message);

  return ok(result.task);
});

export const DELETE = withAuth<Context>(async (_request, { supabase, params }) => {
  const { id } = await params;

  const result = await removeTask(supabase, id);
  if (!result.ok) return fail(result.code, result.message);

  return ok({ id: result.id });
});
