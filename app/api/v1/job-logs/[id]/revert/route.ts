import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { revertJobLog } from "@/lib/api/job-logs";

/**
 * `POST /api/v1/job-logs/:id/revert` — 작업 로그 하나를 되돌린다(`HIST-3`, `HIST-4`, `API-6`).
 *
 * **본문이 없다.** 되돌릴 대상은 경로의 id가 전부 지정하고, 무엇을 되돌릴지(생성이면 삭제,
 * 완료면 미완료)는 로그의 `outcome`이 정한다 — 앱이 고르게 하면 앱과 서버의 판단이 갈라진다.
 *
 * `POST`인 것은 멱등하지 않아서다. 두 번째 호출은 `409`가 되고 그것이 계약이다.
 *
 * 판정도 쓰기도 `lib/api/job-logs.ts`의 `revertJobLog()` → DB 함수에 있다. 여기 남은 것은
 * 봉투뿐이고, `L-P1-04`의 히스토리 화면이 같은 함수를 봉투 없이 부른다(`API-5`).
 */
type Context = RouteContext<"/api/v1/job-logs/[id]/revert">;

export const POST = withAuth<Context>(async (_request, { supabase, params }) => {
  const { id } = await params;

  const result = await revertJobLog(supabase, id);
  if (!result.ok) return fail(result.code, result.message);

  return ok({ jobLogId: result.jobLogId, reverted: result.reverted, taskIds: result.taskIds });
});
