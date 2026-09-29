import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { listJobLogs, toJobLogPayload } from "@/lib/api/job-logs";

/**
 * `GET /api/v1/job-logs` — 작업 로그 목록(`HIST-1`, `API-6`).
 *
 * 쿼리가 없다. 최신 100건 고정이고 정렬·제한은 `listJobLogs`에 있다 — 히스토리 화면이 같은 것을 쓴다.
 * 계측 칸은 `JobLogRecord`가 타입에서 잘라 내므로 이 경로로 샐 수 없다.
 */
export const GET = withAuth(async (_request, { supabase }) => {
  const { data, error } = await listJobLogs(supabase);

  if (error) return fail("INTERNAL_ERROR", "작업 로그를 불러오지 못했습니다.");
  return ok(data.map(toJobLogPayload));
});
