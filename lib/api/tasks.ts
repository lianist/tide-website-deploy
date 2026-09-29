import type { AuthContext } from "@/lib/api/auth";
import type { ErrorCode } from "@/lib/api/envelope";
import { isUuid, nonEmptyString } from "@/lib/api/input";
import type { Database } from "@/lib/supabase/database.types";

/**
 * 태스크 표현 — `docs/04-API-Contract.md` §태스크·태그. 목록·조회·생성·수정이 모두 이 모양을 쓴다.
 */

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type TaskStatus = Database["public"]["Enums"]["task_status"];

/**
 * `user_id`는 내보내지 않는다 — 자기 것만 보이므로 담아 봐야 알려 주는 것이 없다.
 * 태그는 `task_tags`를 거쳐 한 번에 끌어온다. RLS가 조인 양쪽에 걸리므로 남의 태그가 섞일 수 없다.
 */
export const TASK_SELECT =
  "id, title, description, due_at, due_has_time, status, rationale, source, job_log_id, created_at, updated_at, task_tags(tags(id, name))";

export type TaskRecord = Omit<TaskRow, "user_id"> & {
  task_tags: { tags: { id: string; name: string } | null }[];
};

/** DB는 스네이크, API는 카멜. 변환은 이 경계에서 한 번만 한다. */
export function toTaskPayload(row: TaskRecord) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    dueHasTime: row.due_has_time,
    status: row.status,
    rationale: row.rationale,
    source: row.source,
    jobLogId: row.job_log_id,
    // 이름순으로 고정한다. 조인 순서는 보장되지 않아 그대로 두면 같은 태스크가 요청마다 달라 보인다.
    tags: row.task_tags
      .flatMap(({ tags }) => (tags ? [tags] : []))
      .sort((a, b) => a.name.localeCompare(b.name)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 없는 태스크와 남의 태스크에 **같은 답**을 준다. 다르게 답하면 id를 넣어 보는 것만으로
 * 남의 태스크가 실재하는지 알아낼 수 있다(계약 문서 §인증).
 */
export const TASK_NOT_FOUND_MESSAGE = "태스크를 찾을 수 없습니다.";

/** 22P02(invalid text representation) = id가 UUID 꼴이 아니다. 호출부가 404로 합류시킨다. */
export const INVALID_UUID = "22P02";

/** 23503(foreign_key_violation) = `tagIds`에 없거나 남의 태그가 섞였다(복합 FK가 거부). */
export const FOREIGN_KEY_VIOLATION = "23503";

export const UNKNOWN_TAG_MESSAGE = "존재하지 않는 태그가 포함되어 있습니다.";

/** id 하나를 태그까지 실어 읽는다. 안 보이면(없거나 남의 것) `data`가 null. */
export function selectTask(supabase: AuthContext["supabase"], id: string) {
  return supabase.from("tasks").select(TASK_SELECT).eq("id", id).maybeSingle<TaskRecord>();
}

/**
 * 목록 쿼리 — **`DASH-1`의 정렬 규칙이 사는 유일한 자리.** `GET /api/v1/tasks`와 대시보드 화면이
 * 같은 것을 본다. 화면용 체인을 따로 만드는 순간 API와 화면이 갈라지기 시작한다.
 *
 * 미완료가 먼저(열거형 선언 순서가 todo → done), 각각 마감 임박 순, 마감일 없는 것은 끝,
 * 마감이 같으면 먼저 만든 것이 앞이다 — 순서가 요청마다 흔들리지 않게.
 *
 * 태그로 거를 때는 `task_tags`를 **별칭을 붙여 한 번 더** 조인한다. 결과에 싣는 조인에 필터를
 * 걸면 실린 태그까지 그 하나로 잘려 나가기 때문이다 — 거르는 조인과 싣는 조인을 나눈다.
 */
export function listTasks(
  supabase: AuthContext["supabase"],
  {
    status,
    tagId,
    today,
  }: {
    status?: TaskStatus;
    tagId?: string;
    /**
     * 대시보드 '오늘' 보기(`DASH-9`) — 마감이 오늘이거나 이미 지난 미완료 + 마감이 오늘인 완료.
     * 경계는 계정 시간대의 하루(`lib/time.ts`의 `dayBounds`)다. API는 쓰지 않는다.
     */
    today?: { start: string; end: string };
  } = {},
) {
  const select = tagId ? `${TASK_SELECT}, tag_filter:task_tags!inner(tag_id)` : TASK_SELECT;

  let query = supabase.from("tasks").select(select);
  if (status) query = query.eq("status", status);
  if (today) {
    query = query.or(
      `and(status.eq.todo,due_at.lt.${today.end}),` +
        `and(status.eq.done,due_at.gte.${today.start},due_at.lt.${today.end})`,
    );
  }
  if (tagId) query = query.eq("tag_filter.tag_id", tagId);

  return query
    .order("status")
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .overrideTypes<TaskRecord[], { merge: false }>();
}

/** 사용자가 쓸 수 있는 필드. `rationale`·`source`·`jobLogId`는 에이전트 판단의 기록이라 받지 않는다. */
export interface TaskFields {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  /** `dueAt`과 늘 함께 정해진다. 날짜만 있는 마감이면 false(`docs/03-Architecture.md` §설계 결정 14). */
  dueHasTime?: boolean;
  status?: TaskStatus;
  tagIds?: string[];
}

/** 생성을 통과한 결과에는 `title`이 반드시 있다 — 없으면 아래에서 실패로 돌아섰다. */
export type CreateFields = TaskFields & { title: string };

type Parsed<Fields> = { ok: true; fields: Fields } | { ok: false; message: string };

/**
 * 본문에서 태스크 필드를 읽는다. 없는 키는 건드리지 않고(PATCH), `null`은 비운다는 뜻이다.
 * `status`는 생성 때 받지 않는다 — 새 태스크는 언제나 `todo`로 시작한다.
 *
 * **JSON 본문과 FormData가 같은 문을 지난다.** Route Handler는 파싱한 본문을, 대시보드의
 * Server Action은 폼에서 만든 객체를 넣는다 — 검증이 두 벌이 되지 않게.
 *
 * 생성일 때만 반환 타입이 좁아진다. `title`이 있다는 것을 호출부마다 `as`로 다시 말하지 않으려고
 * 오버로드를 둔다 — 단언은 이 함수 안에 한 번만 있다.
 */
export function parseTaskFields(
  body: Record<string, unknown>,
  mode: "create",
): Parsed<CreateFields>;
export function parseTaskFields(body: Record<string, unknown>, mode: "update"): Parsed<TaskFields>;
export function parseTaskFields(
  body: Record<string, unknown>,
  mode: "create" | "update",
): Parsed<CreateFields> | Parsed<TaskFields> {
  const fields: TaskFields = {};

  if (mode === "create" || "title" in body) {
    const title = nonEmptyString(body.title);
    if (!title) return { ok: false, message: "제목을 입력해 주세요." };
    fields.title = title;
  }

  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, message: "설명 형식이 올바르지 않습니다." };
    }
    fields.description = nonEmptyString(body.description);
  }

  if ("dueAt" in body) {
    if (body.dueAt === null) {
      fields.dueAt = null;
    } else {
      const time = typeof body.dueAt === "string" ? Date.parse(body.dueAt) : NaN;
      if (Number.isNaN(time)) return { ok: false, message: "마감일 형식이 올바르지 않습니다." };
      fields.dueAt = new Date(time).toISOString();
    }
  }

  // 시각 여부는 마감과 한 몸이라 `dueAt` 없이 따로 바꾸지 않는다 — 따로 받으면 "마감 없음 + 시각 있음"이
  // DB CHECK에 걸려 500이 된다. `dueAt`만 오면 완전한 타임스탬프이므로 시각이 있는 마감으로 본다.
  if ("dueHasTime" in body) {
    if (typeof body.dueHasTime !== "boolean") {
      return { ok: false, message: "마감 시각 여부 형식이 올바르지 않습니다." };
    }
    if (!("dueAt" in body)) return { ok: false, message: "마감 시각 여부는 마감일과 함께 보내야 합니다." };
  }
  if (fields.dueAt === null) {
    if (body.dueHasTime === true) return { ok: false, message: "마감일이 없으면 시각도 없습니다." };
    fields.dueHasTime = false;
  } else if (fields.dueAt !== undefined) {
    fields.dueHasTime = typeof body.dueHasTime === "boolean" ? body.dueHasTime : true;
  }

  if (mode === "update" && "status" in body) {
    if (body.status !== "todo" && body.status !== "done") {
      return { ok: false, message: "상태는 todo 또는 done이어야 합니다." };
    }
    fields.status = body.status;
  }

  if ("tagIds" in body) {
    if (!Array.isArray(body.tagIds) || !body.tagIds.every(isUuid)) {
      return { ok: false, message: "태그 형식이 올바르지 않습니다." };
    }
    fields.tagIds = body.tagIds;
  }

  if (mode === "update" && Object.keys(fields).length === 0) {
    return { ok: false, message: "바꿀 항목이 없습니다." };
  }
  // `mode === "create"`면 위에서 `title`을 채웠거나 이미 실패로 돌아섰다. 오버로드가 약속한 것을
  // 여기서 한 번만 단언한다.
  return { ok: true, fields: fields as CreateFields };
}

/* ── 쓰기 ─────────────────────────────────────────────────────────────────────
 *
 * RPC 호출과 DB 오류 해석이 여기 있고, **부르는 쪽은 포장만 한다** — Route Handler는 `ok`/`fail`로,
 * 대시보드의 Server Action은 `redirect()`로. 한쪽에만 두면 웹과 앱이 같은 쓰기를 다르게 하게
 * 된다(`API-5`).
 *
 * 경계는 "전송은 밖, DB는 안"이다. 본문 파싱(`readJsonObject`)과 `parseTaskFields`는 밖에 남는다 —
 * Server Action에는 JSON 본문이 없고, 대신 FormData를 같은 모양의 객체로 만들어 **같은
 * `parseTaskFields`를 통과시킨다.** 검증을 두 벌로 만들면 DB CHECK와 짝을 이루는 불변식
 * ("마감이 없으면 시각도 없다")이 한쪽에서만 지켜진다.
 *
 * `ErrorCode`는 타입으로만 들여온다. 값으로 엮으면 이 모듈이 HTTP 봉투에 묶여, 봉투가 없는
 * 호출부가 쓸 수 없게 된다.
 */

export type TaskPayload = ReturnType<typeof toTaskPayload>;

type Failure = { ok: false; code: ErrorCode; message: string };

export type TaskResult = { ok: true; task: TaskPayload } | Failure;

const notFound = (): Failure => ({
  ok: false,
  code: "TASK_NOT_FOUND",
  message: TASK_NOT_FOUND_MESSAGE,
});

const internal = (message: string): Failure => ({ ok: false, code: "INTERNAL_ERROR", message });

const unknownTag = (): Failure => ({
  ok: false,
  code: "VALIDATION_FAILED",
  message: UNKNOWN_TAG_MESSAGE,
});

/** 쓰고 나서 태그까지 실어 다시 읽는다. 쓰기 응답에는 조인이 딸려 오지 않는다. */
async function readBack(
  supabase: AuthContext["supabase"],
  id: string,
  failureMessage: string,
): Promise<TaskResult> {
  const { data, error } = await selectTask(supabase, id);
  if (error || !data) return internal(failureMessage);
  return { ok: true, task: toTaskPayload(data) };
}

/**
 * 태스크를 만든다. 태스크와 태그 연결이 `create_task` 안에서 한 트랜잭션으로 쓰이므로,
 * 태그 하나가 틀리면 태스크도 남지 않는다(설계 결정 13).
 */
export async function insertTask(
  supabase: AuthContext["supabase"],
  fields: TaskFields & { title: string },
): Promise<TaskResult> {
  const { title, description, dueAt, dueHasTime, tagIds } = fields;

  const { data: id, error } = await supabase.rpc("create_task", {
    p_title: title,
    p_description: description ?? undefined,
    p_due_at: dueAt ?? undefined,
    p_due_has_time: dueHasTime,
    p_tag_ids: tagIds ?? [],
  });
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) return unknownTag();
    return internal("태스크를 만들지 못했습니다.");
  }

  return readBack(supabase, id, "태스크를 만들지 못했습니다.");
}

/**
 * 보낸 필드만 고친다. **두 단계다** — 필드는 단일 행 update라 그 자체로 원자적이고, 태그는
 * `set_task_tags`가 지우기와 넣기를 한 트랜잭션으로 한다. 둘 사이에서 끊기면 필드만 바뀐 채
 * 실패가 나가지만, 태그가 비는 중간 상태는 없고 같은 요청을 다시 보내면 수렴한다(설계 결정 13).
 */
export async function patchTask(
  supabase: AuthContext["supabase"],
  id: string,
  fields: TaskFields,
): Promise<TaskResult> {
  const { tagIds, dueAt, dueHasTime, ...rest } = fields;

  // `dueHasTime`은 `dueAt`이 있을 때만 정해진다(`parseTaskFields`) — 둘은 늘 같이 쓰인다.
  const columns = {
    ...rest,
    ...(dueAt !== undefined && { due_at: dueAt, due_has_time: dueHasTime }),
  };
  // 태그만 바꾸는 저장도 있다. 빈 update를 보내면 거부당한다.
  if (Object.keys(columns).length > 0) {
    const { data, error } = await supabase.from("tasks").update(columns).eq("id", id).select("id");
    if (error) {
      if (error.code === INVALID_UUID) return notFound();
      return internal("태스크를 수정하지 못했습니다.");
    }
    if (data.length === 0) return notFound();
  }

  if (tagIds !== undefined) {
    const { data: found, error } = await supabase.rpc("set_task_tags", {
      p_task_id: id,
      p_tag_ids: tagIds,
    });
    if (error) {
      if (error.code === INVALID_UUID) return notFound();
      if (error.code === FOREIGN_KEY_VIOLATION) return unknownTag();
      return internal("태스크를 수정하지 못했습니다.");
    }
    if (!found) return notFound();
  }

  return readBack(supabase, id, "태스크를 불러오지 못했습니다.");
}

/**
 * 태그 연결(`task_tags`)은 FK의 CASCADE로 함께 지워진다. 태그 자체는 남는다.
 *
 * 혼자만 `task`를 돌려주지 않는다 — 지운 것을 다시 읽을 수는 없다.
 */
export async function removeTask(
  supabase: AuthContext["supabase"],
  id: string,
): Promise<{ ok: true; id: string } | Failure> {
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === INVALID_UUID) return notFound();
    return internal("태스크를 삭제하지 못했습니다.");
  }
  if (data.length === 0) return notFound();

  return { ok: true, id };
}
