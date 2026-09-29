import type { AuthContext } from "@/lib/api/auth";
import type { ErrorCode } from "@/lib/api/envelope";
import { INVALID_UUID } from "@/lib/api/tasks";
import type { LlmUsage } from "@/lib/llm";
import type { Database } from "@/lib/supabase/database.types";

/**
 * 작업 로그 — 쓰기(`AGT-8`)와 읽기(`HIST-1`)가 한 파일에 있다.
 *
 * 쓰기는 `recordJobLog()`. 어댑터는 계측값을 **돌려주기만** 하고 쓰지 않는다. 행의 나머지
 * 칸(`outcome`·`capture_summary`)은 LLM 응답을 해석한 뒤에야 정해지므로, 호출이 끝난 뒤 이 함수가
 * 한 행을 **한 번에** 쓴다. `usage`를 선택 인자가 아니라 필수로 둔 것은 계측을 빠뜨린 호출이
 * 컴파일되지 않게 하려는 것이다.
 *
 * 읽기는 `listJobLogs()` + `toJobLogPayload()`. 정렬·제한이 라우트가 아니라 여기 사는 이유는
 * `listTasks`와 같다 — `L-P1-03`의 `/history` 화면이 같은 함수를 부른다. 설계는
 * `docs/03-Architecture.md` §설계 결정 24.
 *
 * 되돌리기(`HIST-3`·`HIST-4`)는 `revertJobLog()`. 판정도 쓰기도 DB 함수 `revert_job_log`가 한
 * 트랜잭션으로 하고 여기서는 행 모양을 HTTP 결과로 옮기기만 한다 — 조건을 두 곳에 적지 않는다.
 * 설계는 §설계 결정 25.
 */

type Enums = Database["public"]["Enums"];
type JobLogRow = Database["public"]["Tables"]["job_logs"]["Row"];

export interface JobLogEntry {
  source: Enums["source_kind"];
  outcome: Enums["job_outcome"];
  /** 실패 시 `docs/04-API-Contract.md`의 에러 코드를 그대로 넣는다. */
  failureReason?: string | null;
  /** 실패해도 남긴다(`AGT-8`). 캡처 원본이 없으므로 히스토리에 남는 것은 이 한 줄이 전부다. */
  captureSummary?: string | null;
  /**
   * 완료 근거 한 문장. **완료 캡처에서만 찬다** — 생성의 근거는 태스크마다 달라 이미
   * `tasks.rationale`에 있고, 로그 수준의 근거라는 것이 생성에는 없다. N개를 이어 붙이면
   * 없던 데이터를 발명하는 것이다.
   */
  rationale?: string | null;
  /** LLM을 부르기 **전에** 실패한 경우에만 null이다. 부른 뒤라면 실패여도 `LlmError.usage`가 있다. */
  usage: LlmUsage | null;
}

/** 요청자의 RLS 클라이언트로 쓴다 — `user_id`는 정책("본인 작업 로그만")이 요구하는 값을 그대로 채운다. */
export async function recordJobLog(
  { supabase, userId }: Pick<AuthContext, "supabase" | "userId">,
  entry: JobLogEntry,
): Promise<string> {
  const { data, error } = await supabase
    .from("job_logs")
    .insert({
      user_id: userId,
      source: entry.source,
      outcome: entry.outcome,
      failure_reason: entry.failureReason ?? null,
      capture_summary: entry.captureSummary ?? null,
      rationale: entry.rationale ?? null,
      model: entry.usage?.model ?? null,
      prompt_tokens: entry.usage?.promptTokens ?? null,
      completion_tokens: entry.usage?.completionTokens ?? null,
      latency_ms: entry.usage?.latencyMs ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * `HIST-1` 목록은 최신 100건이다. 페이지네이션을 열지 않는다 — 커서를 열면 앱과 화면 양쪽에
 * 페이지 상태가 늘고, 지금 필요한 것은 "최근에 무슨 일이 있었나"뿐이다. 나중에 **더하는 변경**으로
 * 열 수 있다.
 */
export const JOB_LOG_LIMIT = 100;

/**
 * `tasks`가 `job_logs`를 두 칸으로 참조하므로 임베딩마다 **어느 칸으로 잇는지**를 밝힌다.
 * 밝히지 않으면 모호해져 타입 단계에서 `SelectQueryError`가 된다 — 런타임 오류가 아니라
 * `npm run typecheck`가 잡는다.
 *
 * `created_at`은 매퍼의 정렬에만 쓰고 응답에는 싣지 않는다.
 *
 * `revert_blocked_reason`은 **실제 칸이 아니라 PostgREST 계산 컬럼**이다(`L-P1-02`). 같은 이름의
 * SQL 함수가 로그 한 행을 받아 "되돌릴 수 없는 사유"를 돌려준다. 계산 컬럼은 `select("*")`에
 * 실리지 않고 **이름을 적어야** 오므로 여기 있어야 한다. 되돌리기 가능 여부를 TypeScript가 다시
 * 계산하지 않는 이유는 `lib/agent/complete.ts`가 선언한 대로 — 판정은 DB 한 곳에만 산다.
 */
export const JOB_LOG_SELECT =
  "id, created_at, source, outcome, failure_reason, capture_summary, rationale, handled_at, " +
  "revert_blocked_reason, " +
  "created_tasks:tasks!job_log_id(id, title, created_at), " +
  "completed_tasks:tasks!completed_by_job_log_id(id, title, created_at)";

type LinkedTask = { id: string; title: string; created_at: string };

/**
 * 계측 칸(`model`·토큰·`latency_ms`)을 `Pick`으로 **잘라 낸다.** 원가 노출이고 앱에도 사용자에게도
 * 쓸 데가 없다. `Omit<Row, "user_id">`로 두면 새 계측 칸이 생길 때 조용히 따라 들어온다.
 */
export type JobLogRecord = Pick<
  JobLogRow,
  | "id"
  | "created_at"
  | "source"
  | "outcome"
  | "failure_reason"
  | "capture_summary"
  | "rationale"
  | "handled_at"
> & {
  /** 계산 컬럼. 되돌릴 수 있으면 `null`이고, 아니면 `REVERT_BLOCK_MESSAGE`의 키다. */
  revert_blocked_reason: string | null;
  created_tasks: LinkedTask[];
  completed_tasks: LinkedTask[];
};

export function listJobLogs(supabase: AuthContext["supabase"]) {
  return supabase
    .from("job_logs")
    .select(JOB_LOG_SELECT)
    .order("created_at", { ascending: false })
    .limit(JOB_LOG_LIMIT)
    .overrideTypes<JobLogRecord[], { merge: false }>();
}

/**
 * `/dashboard?from=<logId>`가 새 태스크 제목에 채울 요약 한 줄(`HIST-2`).
 *
 * **셋이 같은 답으로 합류한다** — 없는 로그·남의 로그(RLS가 0행으로 만든다)·요약이 `null`인 로그
 * (타임아웃과 LLM 오류, 설계 결정 17). 전부 `null`이 되어 화면에서는 **빈 폼** 하나가 된다.
 * 존재 여부가 화면 차이로 새지 않는 것은 `?task=`·`?log=`가 이미 지키는 태도다.
 *
 * `listJobLogs()`를 재사용해 `.find()` 하지 않는다 — 100건 밖의 로그를 조용히 놓친다.
 * 비-UUID는 호출부(`uuidParam`)가 먼저 거르므로 `22P02` 경로가 없다.
 */
export async function jobLogSummary(
  supabase: AuthContext["supabase"],
  id: string,
): Promise<string | null> {
  // `error`를 던지지 않는다. 어느 실패든 도착지가 빈 폼 하나라 분기할 것이 없다.
  const { data } = await supabase
    .from("job_logs")
    .select("capture_summary")
    .eq("id", id)
    .maybeSingle();

  return data?.capture_summary ?? null;
}

/* ───────────────────────── 확인 필요 (`DASH-11`) ───────────────────────── */

/**
 * '확인 필요'에 담기는 로그의 조건. **여기 한 곳에만 적는다** — 건수(`countNeedsReview`)와
 * 목록(`listNeedsReview`)이 같은 조건을 지나야 배지 숫자와 목록 길이가 갈라지지 않는다.
 * 마이그레이션 `job_logs_handled_at`의 부분 인덱스가 같은 조건이다. 바꾸면 둘을 함께 고친다.
 *
 * 생성 캡처의 실패 중 세 사유뿐이다(사용자 결정 2026-09-25). `DUPLICATE_TASK`는 뺀다 — 같은 일의
 * 태스크가 이미 목록에 있고 알림이 그 제목을 말했다. 완료 캡처의 실패도 뺀다 — 피드백이 말한 것은
 * "생성 실패"다.
 */
const NEEDS_REVIEW = {
  source: "capture_create",
  outcome: "failed",
  failureReasons: ["NO_TASK_TO_CREATE", "AGENT_TIMEOUT", "INTERNAL_ERROR"],
} as const;

/** 필터를 한 벌로 건다. 건수와 목록이 각자 적으면 언젠가 한쪽만 고쳐진다. */
function needsReview<
  Q extends {
    eq(column: string, value: string): Q;
    in(column: string, values: readonly string[]): Q;
    is(column: string, value: null): Q;
  },
>(query: Q): Q {
  return query
    .eq("source", NEEDS_REVIEW.source)
    .eq("outcome", NEEDS_REVIEW.outcome)
    .in("failure_reason", NEEDS_REVIEW.failureReasons)
    .is("handled_at", null);
}

/** 사이드바 배지와 '오늘' 배너의 숫자. 행을 가져오지 않는다(`head`). */
export async function countNeedsReview(supabase: AuthContext["supabase"]): Promise<number> {
  const { count, error } = await needsReview(
    supabase.from("job_logs").select("id", { count: "exact", head: true }),
  );

  if (error) throw error;
  return count ?? 0;
}

/**
 * '확인 필요' 보기의 항목들, 최신순. 행 모양이 `listJobLogs()`와 같다 — 화면이 히스토리 항목의
 * 재료(시각·요약·사유 문장)를 그대로 쓰도록 `JOB_LOG_SELECT`·`toJobLogPayload`를 지난다.
 *
 * 개수 제한을 두지 않는다. 받은편지함처럼 비워 가는 목록이라, 100건에서 자르면 배지 숫자와
 * 목록이 어긋난다.
 */
export function listNeedsReview(supabase: AuthContext["supabase"]) {
  return needsReview(supabase.from("job_logs").select(JOB_LOG_SELECT))
    .order("created_at", { ascending: false })
    .overrideTypes<JobLogRecord[], { merge: false }>();
}

/**
 * 로그 하나를 처리함으로 표시한다 — [직접 처리]로 태스크를 저장했을 때와 [넘기기].
 *
 * **아무것도 지우지 않는다.** 히스토리에는 그대로 남는다.
 *
 * `handled_at is null`을 걸어 **처음 처리한 시각을 지킨다**(두 번 눌러도 덮이지 않는다). 없는 로그·
 * 남의 로그(RLS가 0행으로 만든다)·이미 처리한 로그가 모두 0행이 되어 오류 없이 끝난다 — 호출부는
 * 어느 경우든 같은 자리로 돌아가므로 분기할 것이 없고, 소유권을 여기서 비교하지 않는다(결정 9).
 *
 * 범위 밖의 로그(성공·중복·완료 실패)에 불러도 막지 않는다. 그 로그는 '확인 필요'에 없으므로 칸이
 * 차도 보이는 차이가 없다 — 범위 판정을 쓰기 쪽에 한 번 더 적지 않는다.
 */
export async function markLogHandled(supabase: AuthContext["supabase"], id: string): Promise<void> {
  const { error } = await supabase
    .from("job_logs")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", id)
    .is("handled_at", null);

  if (error) throw error;
}

/** DB는 스네이크, API는 카멜. 변환은 이 경계에서 한 번만 한다. */
export function toJobLogPayload(row: JobLogRecord) {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    outcome: row.outcome,
    failureReason: row.failure_reason,
    captureSummary: row.capture_summary,
    rationale: row.rationale,
    /**
     * '확인 필요'에서 처리한 시각(`DASH-11`). 범위 밖의 로그(성공·완료 실패·중복)는 늘 `null`이다 —
     * 이 칸만으로 "확인 필요에 남았나"를 읽을 수 없고, 그 판정은 아래 `NEEDS_REVIEW`가 한다.
     */
    handledAt: row.handled_at,
    /**
     * 두 임베딩을 한 배열로 합친다. 한 로그가 둘을 동시에 채울 수 없어서다 —
     * `capture_create`·`mail`은 `job_log_id`만, `capture_complete`는 `completed_by_job_log_id`만
     * 심는다. 나눠 내보내면 읽는 쪽이 늘 빈 배열 하나를 무시하게 되고, 어느 쪽이 찼는지는
     * `source`가 이미 말한다.
     *
     * 만든 순서로 고정한다. 조인 순서는 보장되지 않아 그대로 두면 요청마다 달라 보인다
     * (`toTaskPayload`가 태그를 이름순으로 고정한 것과 같은 자리·같은 이유).
     */
    tasks: [...row.created_tasks, ...row.completed_tasks]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map(({ id, title }) => ({ id, title })),
    /**
     * 판정은 DB의 `revert_blocked_reason()`이 하고 여기서는 뒤집기만 한다. 조건을 TypeScript로
     * 옮겨 적으면 목록의 버튼과 실제 되돌리기 결과가 갈라진다.
     *
     * **참고값이다.** 읽은 뒤 사용자가 그 태스크를 고치면 뒤집히고, 진짜 판정은
     * `POST …/revert`가 한 트랜잭션 안에서 다시 한다.
     */
    revertable: row.revert_blocked_reason === null,
  };
}

/**
 * 응답 한 건의 모양. **매퍼에서 뽑는다** — 손으로 다시 적으면 칸이 갈리고, 특히 계측 칸을 잘라
 * 낸 `Pick`의 효력이 여기서 조용히 풀린다(§설계 결정 24). `/history` 화면이 이 타입을 쓴다.
 */
export type JobLogPayload = ReturnType<typeof toJobLogPayload>;

/* ───────────────────────── 되돌리기 (`HIST-3`·`HIST-4`) ───────────────────────── */

/**
 * 없는 로그와 남의 로그에 **같은 답**을 준다 — `TASK_NOT_FOUND_MESSAGE`와 같은 이유다.
 * 다르게 답하면 id를 넣어 보는 것만으로 남의 기록이 실재하는지 알아낼 수 있다.
 */
export const JOB_LOG_NOT_FOUND_MESSAGE = "작업 기록을 찾을 수 없습니다.";

/** DB의 `revert_blocked_reason()`이 내는 사유 코드. */
export type RevertBlockReason =
  | "TASK_MODIFIED"
  | "TASK_GONE"
  | "ALREADY_REVERTED"
  | "NOTHING_TO_REVERT";

/**
 * 되돌릴 수 없는 사유 → 사용자가 읽을 한국어 문장. **이 표가 하나뿐이다** — `409` 응답의
 * `message`도, `L-P1-04`의 히스토리 화면이 띄우는 안내도 여기서 나온다(`API-5`).
 */
const REVERT_BLOCK_MESSAGE: Record<RevertBlockReason, string> = {
  // '사용자가'를 뺐다. 에이전트의 완료도 `updated_at`을 올려 사용자 편집과 구분되지 않는다 —
  // 구분할 수 없는 것을 구분한다고 말하지 않는다. 누가 바꿨든 이 문장은 참이다.
  TASK_MODIFIED: "생성 이후 태스크가 변경되어 되돌릴 수 없습니다.",
  // "삭제되었습니다"라고 쓰지 않는다. 다른 캡처가 그 태스크를 다시 닫아 연결이 덮인 경우에도
  // 여기로 오는데(설계 결정 16), 그때 태스크는 멀쩡히 살아 있다. 둘 다에서 참인 문장만 쓴다.
  TASK_GONE: "되돌릴 태스크가 남아 있지 않습니다.",
  ALREADY_REVERTED: "이미 되돌린 작업입니다.",
  NOTHING_TO_REVERT: "되돌릴 내용이 없는 기록입니다.",
};

const UNKNOWN_BLOCK_MESSAGE = "지금은 되돌릴 수 없습니다.";

/** 표에 없는 코드가 와도 사용자에게는 문장이 간다 — 빈 `message`가 나가는 일이 없게. */
export function revertBlockMessage(reason: string): string {
  return Object.hasOwn(REVERT_BLOCK_MESSAGE, reason)
    ? REVERT_BLOCK_MESSAGE[reason as RevertBlockReason]
    : UNKNOWN_BLOCK_MESSAGE;
}

/**
 * `/history?error=<token>`에 실린 토큰 → 사용자가 읽을 문장(`L-P1-04`).
 *
 * **표가 늘지 않는다.** 거절 사유는 위의 `REVERT_BLOCK_MESSAGE` 그대로고, 여기서 더하는 것은
 * 되돌리기가 사유 없이 실패하는 두 갈래(없는 로그·내부 오류)뿐이다. 히스토리 화면이 문장을 자기
 * 파일에 복사해 두면 `409` 응답과 화면이 언젠가 다른 말을 한다(`API-5`).
 */
export function revertErrorMessage(token: string): string {
  return token === "JOB_LOG_NOT_FOUND" ? JOB_LOG_NOT_FOUND_MESSAGE : revertBlockMessage(token);
}

/** 되돌린 것은 로그의 `outcome`을 되비친다. 실패 로그는 늘 막히므로 `failed`가 올 수 없다. */
export type RevertedKind = Exclude<Enums["job_outcome"], "failed">;

export type RevertResult =
  | { ok: true; jobLogId: string; reverted: RevertedKind; taskIds: string[] }
  /**
   * `reason`은 **화면이 URL에 실을 토큰**이다(`L-P1-04`). `code`는 네 가지 거절 사유를
   * `REVERT_NOT_POSSIBLE` 하나로 접어 버려 어느 사유였는지를 잃는다 — 봉투에는 그것이 맞지만
   * (앱의 분기는 굵어야 한다) 화면은 사유별 문장을 띄워야 한다. Route Handler는 이 칸을 읽지 않는다.
   */
  | { ok: false; code: ErrorCode; message: string; reason: string };

/** 생성 타입은 세 칸을 non-null로 잡지만 실제로는 갈래마다 한쪽이 비어 온다. */
type RevertRow = {
  reverted: Enums["job_outcome"] | null;
  blocked_reason: string | null;
  task_ids: string[] | null;
};

const notFound = (): RevertResult => ({
  ok: false,
  code: "JOB_LOG_NOT_FOUND",
  message: JOB_LOG_NOT_FOUND_MESSAGE,
  reason: "JOB_LOG_NOT_FOUND",
});

const internal = (): RevertResult => ({
  ok: false,
  code: "INTERNAL_ERROR",
  message: "작업을 되돌리지 못했습니다.",
  reason: "INTERNAL_ERROR",
});

/**
 * 작업 로그 하나를 되돌린다. 세 결과를 **행 모양으로** 구분해 받는다(설계 결정 25).
 *
 * - 0행 → 없거나 남의 로그. RLS가 이미 걸러 냈으므로 소유권을 여기서 비교하지 않는다.
 * - `blocked_reason` → `409`. 문장은 위의 표가 붙인다.
 * - `reverted`·`task_ids` → `200`.
 *
 * 비-UUID는 정규식으로 미리 거르지 않는다. 인자 캐스팅이 `22P02`로 터지므로 그것을 잡아
 * 없는 로그와 같은 `404`로 합류시킨다 — `lib/api/tasks.ts`의 경로와 같은 태도다.
 */
export async function revertJobLog(
  supabase: AuthContext["supabase"],
  id: string,
): Promise<RevertResult> {
  const { data, error } = await supabase
    .rpc("revert_job_log", { p_job_log_id: id })
    .overrideTypes<RevertRow[], { merge: false }>();

  if (error) {
    if (error.code === INVALID_UUID) return notFound();
    return internal();
  }

  const [row] = data;
  if (!row) return notFound();

  if (row.blocked_reason !== null) {
    return {
      ok: false,
      code: "REVERT_NOT_POSSIBLE",
      message: revertBlockMessage(row.blocked_reason),
      reason: row.blocked_reason,
    };
  }

  // 여기 도달했다면 함수가 쓰기를 마친 것이고, 실패 로그는 위 갈래에서 막혔다. 단언으로
  // 좁히는 대신 막아 둔다 — DB가 예상 밖의 모양을 내면 500이 낫지 잘못된 200이 낫지 않다.
  if (row.reverted === null || row.reverted === "failed" || row.task_ids === null) {
    return internal();
  }

  return { ok: true, jobLogId: id, reverted: row.reverted, taskIds: row.task_ids };
}
