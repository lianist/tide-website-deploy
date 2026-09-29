import type { AuthContext } from "@/lib/api/auth";
import type { ErrorCode } from "@/lib/api/envelope";
import { isUuid, nonEmptyString } from "@/lib/api/input";
import { INVALID_UUID } from "@/lib/api/tasks";
import type { Database } from "@/lib/supabase/database.types";

/**
 * 태그의 쓰기 전부 — `docs/04-API-Contract.md` §태스크·태그, §태그 합치기.
 *
 * **Route Handler와 Server Action이 이 파일 하나를 나눠 쓴다**(`API-5`). 앱은 `/api/v1/tags/*`로,
 * 웹의 태그 관리 패널(`L-P1-06`)은 Server Action으로 들어오지만 DB 호출과 오류 해석은 한 벌이다 —
 * `lib/api/tasks.ts`가 `L-P0-12`에서 한 이동과 같다(설계 결정 20). 양쪽에 남는 것은 포장뿐이다:
 * 라우트는 `ok`/`fail`, Server Action은 `redirect()`.
 */

type TagRow = Database["public"]["Tables"]["tags"]["Row"];

export const TAG_COLUMNS = "id, name, created_at";

export function toTagPayload(row: Pick<TagRow, "id" | "name" | "created_at">) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export type TagPayload = ReturnType<typeof toTagPayload>;

/**
 * 가입 트리거가 만드는 태그(설계 결정 11). 에이전트가 "판단이 어려우면 여기에 넣는다"(`AGT-5`)는
 * 전제라 이름을 바꾸거나 지우지 못하게 한다 — 막는 곳은 DB 트리거가 아니라 핸들러다. 트리거로 막으면
 * 계정 삭제의 CASCADE(`SET-1`)까지 막힌다(설계 결정 13).
 *
 * ⚠️ **같은 문자열이 세 곳에 더 있다** — `…_signup_bootstrap.sql`(이 태그를 만드는 트리거),
 * `…_merge_tags.sql`(병합 출발점 보호), 그리고 `lib/agent/create.ts`(태그를 못 고르면 여기 넣는다).
 * 병합만 SQL 쪽인 이유는 rpc 한 번이라 `.neq()`를 쓰기에 실을 자리가 없기 때문이고, 넷이 갈라지면
 * `e2e/tags.spec.ts`의 "'미분류' 출발 → 409"가 빨간불이 된다.
 */
export const UNCATEGORIZED = "미분류";

export const TAG_NOT_FOUND_MESSAGE = "태그를 찾을 수 없습니다.";
export const TAG_NAME_TAKEN_MESSAGE = "같은 이름의 태그가 이미 있습니다.";
export const TAG_PROTECTED_MESSAGE = "'미분류' 태그는 바꾸거나 지울 수 없습니다.";
export const TAG_NAME_REQUIRED_MESSAGE = "태그 이름을 입력해 주세요.";
export const TAG_MERGE_INVALID_MESSAGE = "합칠 태그를 선택해 주세요.";
export const TAG_MERGE_SAME_MESSAGE = "서로 다른 두 태그를 골라 주세요.";

/** 23505(unique_violation) = `(user_id, name)` 유니크에 걸렸다. */
export const UNIQUE_VIOLATION = "23505";

/* ───────────────────────────────── 결과 모양 ───────────────────────────────── */

/**
 * 화면이 `?error=`에 실을 토큰(`L-P1-06`). **`code`보다 잘게 쪼갠다** — `VALIDATION_FAILED` 하나가
 * 서로 다른 문장 셋("이름을 입력해 주세요"·"합칠 태그를 선택해 주세요"·"서로 다른 두 태그를")을
 * 삼켜 어느 실패였는지를 잃기 때문이다.
 *
 * `revertJobLog`의 `reason`과 같은 칸이고 같은 이유로 있다(`lib/api/job-logs.ts`, `L-P1-04`).
 * 봉투에는 굵은 `code`가 맞고(앱의 분기는 굵어야 한다) 화면은 사유별 문장을 띄워야 한다.
 * **Route Handler는 이 칸을 읽지 않으므로 응답은 한 글자도 바뀌지 않는다.**
 */
export type TagErrorReason =
  | "TAG_NOT_FOUND"
  | "TAG_NAME_TAKEN"
  | "TAG_PROTECTED"
  | "TAG_NAME_REQUIRED"
  | "TAG_MERGE_INVALID"
  | "TAG_MERGE_SAME"
  | "INTERNAL_ERROR";

/** 실패의 모양은 셋이 같다. 성공만 갈린다. */
type TagFailure = { ok: false; code: ErrorCode; message: string; reason: TagErrorReason };

export type TagResult = { ok: true; tag: TagPayload } | TagFailure;

/**
 * 삭제만 `tag`를 못 돌려준다 — 지운 행을 다시 읽을 수 없다. 억지로 `TagResult`로 통일하면 지워진
 * 태그를 지어내거나 `tag: null`을 들게 된다. `lib/api/tasks.ts`의 `removeTask`가 같은 자리에서
 * 같은 결론에 닿았다.
 */
export type TagDeleteResult = { ok: true; id: string } | TagFailure;

export type MergeTagsResult = TagResult;

const FAILURE: Record<TagErrorReason, { code: ErrorCode; message: string }> = {
  TAG_NOT_FOUND: { code: "TAG_NOT_FOUND", message: TAG_NOT_FOUND_MESSAGE },
  TAG_NAME_TAKEN: { code: "TAG_NAME_TAKEN", message: TAG_NAME_TAKEN_MESSAGE },
  TAG_PROTECTED: { code: "TAG_PROTECTED", message: TAG_PROTECTED_MESSAGE },
  TAG_NAME_REQUIRED: { code: "VALIDATION_FAILED", message: TAG_NAME_REQUIRED_MESSAGE },
  TAG_MERGE_INVALID: { code: "VALIDATION_FAILED", message: TAG_MERGE_INVALID_MESSAGE },
  TAG_MERGE_SAME: { code: "VALIDATION_FAILED", message: TAG_MERGE_SAME_MESSAGE },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", message: "" },
};

const failed = (reason: Exclude<TagErrorReason, "INTERNAL_ERROR">): TagFailure => ({
  ok: false,
  reason,
  ...FAILURE[reason],
});

/**
 * 내부 오류 문장은 **하는 일마다 다르다**("수정하지 못했습니다" / "삭제하지 못했습니다" /
 * "불러오지 못했습니다" / "합치지 못했습니다"). 하나로 합치면 `e2e/tags.spec.ts`가 고정해 둔 응답이
 * 바뀐다 — 이 이동이 계약을 건드리지 않았다는 증거가 그 문장들이다.
 */
const internal = (message: string): TagFailure => ({
  ok: false,
  reason: "INTERNAL_ERROR",
  code: "INTERNAL_ERROR",
  message,
});

/**
 * `/history?error=`의 `revertErrorMessage`와 같은 물건(`L-P1-04`의 선례). 사유 토큰 → 사용자가 읽을
 * 문장이고, **표가 늘지 않는다** — 위의 `FAILURE`가 이미 들고 있는 문장을 꺼낼 뿐이다.
 *
 * 패널의 배너와 `409`/`400` 응답의 `message`가 **같은 자리**에서 나온다(`API-5`). 화면이 문장을
 * 자기 파일에 복사해 두면 앱과 웹이 언젠가 다른 말을 한다.
 */
export function tagErrorMessage(token: string): string {
  const known = Object.hasOwn(FAILURE, token) && token !== "INTERNAL_ERROR";
  return known
    ? FAILURE[token as TagErrorReason].message
    : "문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";
}

/* ─────────────────────────────── 생성 (`API-2`) ─────────────────────────────── */

/**
 * 태그 생성. `POST /api/v1/tags`와 상세 패널의 '새 태그' 칸(HF-10)이 같이 쓴다.
 *
 * `userId`는 RLS의 with check가 요구하는 값이다. 소유권 비교가 아니라 "내 것으로 만든다"는 선언이다.
 */
export async function createTag(
  supabase: AuthContext["supabase"],
  userId: string,
  name: unknown,
): Promise<TagResult> {
  const trimmed = nonEmptyString(name);
  if (!trimmed) return failed("TAG_NAME_REQUIRED");

  const { data, error } = await supabase
    .from("tags")
    .insert({ user_id: userId, name: trimmed })
    .select(TAG_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return failed("TAG_NAME_TAKEN");
    return internal("태그를 만들지 못했습니다.");
  }
  return { ok: true, tag: toTagPayload(data) };
}

/**
 * 이름으로 태그를 확보한다 — 있으면 그것을, 없으면 만든다. 상세 패널의 '새 태그' 칸이 쓴다(HF-10).
 * 사용자는 이미 있는 이름을 칸에 다시 칠 수 있고, 그때 "같은 이름이 있다"고 거절하면 원하는 일
 * (그 태그를 붙이기)을 못 한 채 폼만 다시 채워야 한다. 만들기를 먼저 해 보고 23505면 읽는다 —
 * 먼저 읽으면 읽기와 만들기 사이에 틈이 생긴다(`explainNoop`과 같은 순서).
 */
export async function ensureTag(
  supabase: AuthContext["supabase"],
  userId: string,
  name: unknown,
): Promise<TagResult> {
  const created = await createTag(supabase, userId, name);
  if (created.ok || created.reason !== "TAG_NAME_TAKEN") return created;

  const { data, error } = await supabase
    .from("tags")
    .select(TAG_COLUMNS)
    .eq("name", nonEmptyString(name)!)
    .single();
  if (error) return internal("태그를 불러오지 못했습니다.");
  return { ok: true, tag: toTagPayload(data) };
}

/* ──────────────────────── 이름 변경·삭제 (`API-2`) ──────────────────────── */

/**
 * 쓰기가 0행이었을 때 — 태그가 보이면 '미분류'라서 `.neq()`에 걸린 것이고, 안 보이면 없거나 남의
 * 것이다. **먼저 읽고 판단하지 않는다**: 읽기와 쓰기 사이에 틈이 생긴다. 0행이 나온 뒤에만 한 번 더
 * 읽어 이유를 가른다.
 *
 * ⚠️ 이 함수는 `.neq("name", UNCATEGORIZED)`와 **한 몸이다.** 저쪽이 0행을 두 뜻으로 만들기 때문에
 * 이쪽이 있다. 갈라 두면 한쪽만 고치는 일이 생긴다.
 */
async function explainNoop(
  supabase: AuthContext["supabase"],
  id: string,
): Promise<TagFailure> {
  const { data, error } = await supabase.from("tags").select("id").eq("id", id).maybeSingle();
  if (error) return internal("태그를 불러오지 못했습니다.");
  return data ? failed("TAG_PROTECTED") : failed("TAG_NOT_FOUND");
}

/**
 * 태그 이름 변경(`API-2`의 "수정", `DASH-6`의 절반).
 *
 * **이름 검증이 id보다 먼저다.** 본문이 비어 있으면 id가 무엇이든 `400`이고, `e2e/tags.spec.ts`가
 * 그 순서를 고정하고 있다.
 *
 * 🔴 **`isUuid` 선검사를 넣지 않는다.** 경로의 `:id`는 비-UUID가 `22P02`를 타고 **`404`에 합류**하는
 * 것이 계약이다(없는 자원과 본문까지 같다). 선검사를 넣으면 그것이 `400`으로 바뀐다 —
 * `mergeTags`와 갈리는 지점이고, 아래 주석이 그 비대칭을 설명한다.
 */
export async function renameTag(
  supabase: AuthContext["supabase"],
  id: string,
  name: unknown,
): Promise<TagResult> {
  const trimmed = nonEmptyString(name);
  if (!trimmed) return failed("TAG_NAME_REQUIRED");

  const { data, error } = await supabase
    .from("tags")
    .update({ name: trimmed })
    .eq("id", id)
    .neq("name", UNCATEGORIZED)
    .select(TAG_COLUMNS);

  if (error) {
    if (error.code === INVALID_UUID) return failed("TAG_NOT_FOUND");
    if (error.code === UNIQUE_VIOLATION) return failed("TAG_NAME_TAKEN");
    return internal("태그를 수정하지 못했습니다.");
  }
  if (data.length === 0) return explainNoop(supabase, id);

  return { ok: true, tag: toTagPayload(data[0]!) };
}

/** 태그가 달려 있던 태스크는 남는다. 연결(`task_tags`)만 FK의 CASCADE로 떨어진다. */
export async function removeTag(
  supabase: AuthContext["supabase"],
  id: string,
): Promise<TagDeleteResult> {
  const { data, error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .neq("name", UNCATEGORIZED)
    .select("id");

  if (error) {
    if (error.code === INVALID_UUID) return failed("TAG_NOT_FOUND");
    return internal("태그를 삭제하지 못했습니다.");
  }
  if (data.length === 0) return explainNoop(supabase, id);

  return { ok: true, id };
}

/* ─────────────────────────────── 병합 (`DASH-6`·`API-6`) ─────────────────────────────── */

/**
 * DB 함수가 내는 사유는 **계약의 에러 코드 문자열 그대로**다(`job_logs.failure_reason`의 선례).
 * 덕분에 사유→코드 변환표가 없고 이 표는 위의 `FAILURE`로 바로 들어간다.
 */
const MERGE_BLOCK_REASON: Partial<Record<string, Exclude<TagErrorReason, "INTERNAL_ERROR">>> = {
  TAG_NOT_FOUND: "TAG_NOT_FOUND",
  TAG_PROTECTED: "TAG_PROTECTED",
};

/** 생성 타입은 네 칸을 non-null로 잡지만 실제로는 갈래마다 한쪽이 비어 온다. */
type MergeRow = {
  id: string | null;
  name: string | null;
  created_at: string | null;
  blocked_reason: string | null;
};

/**
 * 태그 둘을 하나로 합친다(`DASH-6`). 옮기기와 지우기는 DB 함수 `merge_tags`가 한 트랜잭션으로
 * 하고, 여기서는 입력 검증과 행 모양 → HTTP 결과 변환만 한다(설계 결정 13·25).
 *
 * **입력을 `unknown`으로 받고 검증을 이 안에 둔다.** Server Action은 `FormData`에서, Route Handler는
 * JSON 본문에서 값을 꺼내 와 둘 다 모양이 보장되지 않는다. 검증을 라우트에 두면 Server Action
 * 쪽에서 언젠가 빠진다(`API-5`).
 *
 * 🔴 **비-UUID를 404로 합류시키지 않는다 — 위의 `renameTag`·`removeTag`와 반대다.** 저쪽의 id는
 * **경로**에서 와서 `22P02`가 "없는 자원"과 같은 뜻이고, 여기 두 id는 **본문**이라 "형식이 틀렸다"가
 * 그대로 `400`이다. 한 파일 안에 규율이 둘인 것이 의도이고, "통일"하면 `e2e/tags.spec.ts`의
 * 404 단언과 400 단언이 **동시에** 깨진다.
 *
 * 결과는 **행 모양으로** 구분한다. `blocked_reason`이 있으면 그 값이 곧 에러 코드다.
 */
export async function mergeTags(
  supabase: AuthContext["supabase"],
  input: { sourceId: unknown; targetId: unknown },
): Promise<MergeTagsResult> {
  const { sourceId, targetId } = input;
  if (!isUuid(sourceId) || !isUuid(targetId)) return failed("TAG_MERGE_INVALID");
  // 자기 자신과의 병합은 결과가 정의되지 않는다(방금 지운 태그로 연결을 옮기게 된다). 함수도
  // WHERE로 막아 두었지만, 사용자에게 갈 답은 "없는 태그"가 아니라 "둘을 고르라"는 400이다.
  if (sourceId === targetId) return failed("TAG_MERGE_SAME");

  const { data, error } = await supabase
    .rpc("merge_tags", { p_source_id: sourceId, p_target_id: targetId })
    .overrideTypes<MergeRow[], { merge: false }>();

  if (error) return internal("태그를 합치지 못했습니다.");

  const [row] = data;
  if (!row) return internal("태그를 합치지 못했습니다.");

  if (row.blocked_reason !== null) {
    const reason = MERGE_BLOCK_REASON[row.blocked_reason];
    // 표에 없는 사유 = DB와 이 파일이 갈라졌다는 뜻이다. 빈 문장을 내보내느니 500이 낫다.
    if (reason === undefined) return internal("태그를 합치지 못했습니다.");
    return failed(reason);
  }

  // 여기 도달했으면 함수가 도착 태그 한 행을 냈다. 단언으로 좁히는 대신 막아 둔다 — DB가 예상
  // 밖의 모양을 내면 500이 낫지 잘못된 200이 낫지 않다(`revertJobLog`와 같은 태도).
  if (row.id === null || row.name === null || row.created_at === null) {
    return internal("태그를 합치지 못했습니다.");
  }

  return {
    ok: true,
    tag: toTagPayload({ id: row.id, name: row.name, created_at: row.created_at }),
  };
}
