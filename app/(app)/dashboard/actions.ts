"use server";

import { refresh } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { isUuid } from "@/lib/api/input";
import { markLogHandled } from "@/lib/api/job-logs";
import { ensureTag, mergeTags, removeTag, renameTag } from "@/lib/api/tags";
import { insertTask, parseTaskFields, patchTask, removeTask } from "@/lib/api/tasks";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireConsentedUser, userTimeZone } from "@/lib/supabase/session";
import { toDueAt } from "@/lib/time";

import { dashboardUrl, viewOf } from "./url";

/**
 * 상세 패널이 부르는 Server Action들(`DASH-4`).
 *
 * `app/(auth)/actions.ts`와 같은 규약이다 — 화면에 상태를 돌려주지 않고 **결과를 URL에 실어**
 * 리다이렉트한다. 덕분에 이 루프에도 클라이언트 컴포넌트가 하나도 없다.
 *
 * **쓰기의 알맹이는 여기 없다.** `lib/api/tasks.ts`의 `insertTask`·`patchTask`·`removeTask`가
 * Route Handler와 공유되고, 검증도 같은 `parseTaskFields`를 지난다(`API-5`). 여기 있는 것은
 * 폼을 그 모양으로 옮기는 일과 끝난 뒤 어디로 갈지 정하는 일뿐이다.
 *
 * ⚠️ `redirect()`는 `NEXT_REDIRECT` 예외를 던져 흐름을 끊는다. **`try`/`catch` 안에서 부르면
 * 리다이렉트가 에러로 잡아먹힌다.**
 */

/** 폼에서 문자열 한 칸. FormData는 File도 담을 수 있어 타입을 좁혀야 한다. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 성공했으니 같은 자리로 돌아간다.
 *
 * **둘 다 부르는 것이 의도다.** `refresh()`가 없으면 URL이 그대로일 때 현재 라우트가 다시 그려지지
 * 않고(Next 16 Server Actions 가이드: "An action that does none of the above … the current route is
 * not re-rendered"), `redirect()`가 없으면 앞선 실패가 남긴 `?error=`가 주소에 남아 **고쳐서
 * 저장했는데도 빨간 문구가 계속 보인다.** 뒤로가기가 죽은 상태로 돌아가지 않도록 `replace`다.
 */
function backTo(url: string): never {
  refresh();
  redirect(url, RedirectType.replace);
}

/**
 * 마감 두 칸(`YYYY-MM-DD` + `HH:MM`)을 `dueAt`·`dueHasTime`으로 옮긴다.
 *
 * **`toDueAt`이 내는 null을 "마감 없음"으로 읽지 않는다.** 그것은 `2026-02-30`처럼 실재하지 않는
 * 날짜라는 뜻이고, 마감 없음으로 합류시키면 사용자의 마감이 소리 없이 지워진다.
 */
function dueFrom(
  formData: FormData,
  timeZone: string,
): { ok: true; dueAt: string | null; dueHasTime: boolean } | { ok: false; error: string } {
  const date = field(formData, "dueDate");
  // `<input type="time">`은 보통 `HH:MM`이지만 초까지 싣는 브라우저가 있다. `toDueAt`의 형식 검사는
  // 그것을 거부하므로 여기서 잘라 둔다.
  const time = field(formData, "dueTime").slice(0, 5);

  if (!date) {
    // 날짜 없이 시각만 고른 것은 조용히 버리지 않는다 — 버리면 마감을 넣었다고 믿게 된다.
    if (time) return { ok: false, error: "due_date_required" };
    return { ok: true, dueAt: null, dueHasTime: false };
  }

  const dueAt = toDueAt(date, time || null, timeZone);
  if (!dueAt) return { ok: false, error: "due_date_invalid" };

  return { ok: true, dueAt, dueHasTime: Boolean(time) };
}

/**
 * 실패 코드를 화면이 아는 코드로. `parseTaskFields`의 문장은 API의 것이라 여기서 쓰지 않는다.
 *
 * `VALIDATION_FAILED`는 `tagIds`에 없거나 남의 태그가 섞였을 때다(`lib/api/tasks.ts`
 * §`FOREIGN_KEY_VIOLATION`). 상세 폼이 HF-10부터 태그를 다시 보내므로 — 다른 탭에서 그 태그를 지운
 * 뒤 저장하면 — 여기 닿을 수 있다.
 */
const ERROR_CODE: Record<string, string> = {
  TASK_NOT_FOUND: "not_found",
  VALIDATION_FAILED: "validation_failed",
  INTERNAL_ERROR: "unknown",
};

/**
 * 폼의 태그 칸(`panel.tsx` §`Fields`) → `tagIds`. `undefined`면 **키를 싣지 않는다** — 태그를 건드리지
 * 않았다는 뜻이고, `patchTask`는 키가 있을 때만 덮어쓴다.
 *
 * - '새 태그' 칸이 채워졌으면 그 이름의 태그를 확보해(있으면 재사용) 그것 하나.
 * - 아니면 고른 태그 하나. 단 `changedOnly`(저장)에서는 처음 골라져 있던 값과 같으면 보내지 않는다 —
 *   에이전트가 둘을 단 태스크의 제목만 고쳐도 태그가 하나로 줄지 않게.
 */
async function tagIdsFrom(
  formData: FormData,
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  changedOnly: boolean,
): Promise<{ ok: true; tagIds: string[] | undefined } | { ok: false }> {
  const newTag = field(formData, "newTag");
  if (newTag) {
    const result = await ensureTag(supabase, userId, newTag);
    return result.ok ? { ok: true, tagIds: [result.tag.id] } : { ok: false };
  }

  const tagId = field(formData, "tagId");
  if (!tagId || (changedOnly && tagId === field(formData, "tagOriginal"))) {
    return { ok: true, tagIds: undefined };
  }
  return { ok: true, tagIds: [tagId] };
}

/** 사용자가 직접 만드는 태스크. 생성 경로는 `create_task`의 기본값 그대로 `manual`이다. */
export async function createTask(formData: FormData): Promise<void> {
  const user = await requireConsentedUser();
  const supabase = await createServerSupabase();
  const tag = field(formData, "tag");
  const view = viewOf(field(formData, "view"));
  /*
    히스토리에서 이어받은 작업 로그(`?from=`, `HIST-2`). **실패 리다이렉트마다 다시 실어 준다** —
    빠뜨리면 요약이 채워진 폼에서 날짜 없이 마감 시각만 골라 저장했을 때(`due_date_required`)
    제목이 빈 칸으로 돌아오고, 사용자는 빈 폼 + 빨간 문구를 본다. 성공 뒤에는 따라가지 않는다.
  */
  const from = field(formData, "from");

  const timeZone = await userTimeZone(supabase, user.id);
  const due = dueFrom(formData, timeZone);
  if (!due.ok) {
    redirect(dashboardUrl({ view, tag, isNew: true, from, error: due.error }), RedirectType.replace);
  }

  const tags = await tagIdsFrom(formData, supabase, user.id, false);
  if (!tags.ok) {
    redirect(dashboardUrl({ view, tag, isNew: true, from, error: "unknown" }), RedirectType.replace);
  }

  const parsed = parseTaskFields(
    {
      title: field(formData, "title"),
      description: field(formData, "description"),
      dueAt: due.dueAt,
      dueHasTime: due.dueHasTime,
      ...(tags.tagIds && { tagIds: tags.tagIds }),
    },
    "create",
  );
  if (!parsed.ok) {
    redirect(
      dashboardUrl({ view, tag, isNew: true, from, error: "title_required" }),
      RedirectType.replace,
    );
  }

  const result = await insertTask(supabase, parsed.fields);
  if (!result.ok) {
    redirect(
      dashboardUrl({ view, tag, isNew: true, from, error: ERROR_CODE[result.code] ?? "unknown" }),
      RedirectType.replace,
    );
  }

  /*
    `DASH-11` — [직접 처리]로 **저장까지 했을 때만** 그 로그가 '확인 필요'에서 빠진다. 패널을 열고
    닫기만 하면 이 줄에 오지 않으므로 남는다.

    실패해도 삼킨다. 태스크는 이미 저장됐는데 여기서 던지면 사용자는 에러 화면을 보고 다시 저장해
    **같은 태스크가 둘이 된다.** 처리 표시가 빠진 대가는 항목이 남는 것뿐이고, [넘기기]로 치울 수 있다.
    비-UUID `from`은 요약 조회(`jobLogSummary`)처럼 여기서도 걸러 둔다 — `22P02`로 가지 않게.
  */
  if (isUuid(from)) {
    await markLogHandled(supabase, from).catch((error: unknown) => {
      console.error("markLogHandled failed", error);
    });
  }

  // **필터를 떨구고 간다.** `?tag=업무`가 걸린 채 그 태그 없이 만들면 패널은 열리는데 목록에는
  // 없는 화면이 된다. 뒤로가기로 빈 폼에 돌아올 수 있도록 여기만 `push`(기본값)다.
  redirect(dashboardUrl({ view, task: result.task.id }));
}

/** 제목·설명·마감·태그를 한 번에 저장한다. 상태는 아래 `setTaskStatus`가 맡는다. */
export async function saveTask(formData: FormData): Promise<void> {
  const user = await requireConsentedUser();
  const supabase = await createServerSupabase();
  const tag = field(formData, "tag");
  const view = viewOf(field(formData, "view"));
  const id = field(formData, "id");

  if (!isUuid(id)) redirect(dashboardUrl({ view, tag, error: "not_found" }), RedirectType.replace);

  const timeZone = await userTimeZone(supabase, user.id);
  const due = dueFrom(formData, timeZone);
  if (!due.ok) {
    redirect(dashboardUrl({ view, tag, task: id, error: due.error }), RedirectType.replace);
  }

  const tags = await tagIdsFrom(formData, supabase, user.id, true);
  if (!tags.ok) redirect(dashboardUrl({ view, tag, task: id, error: "unknown" }), RedirectType.replace);

  const parsed = parseTaskFields(
    {
      title: field(formData, "title"),
      description: field(formData, "description"),
      dueAt: due.dueAt,
      dueHasTime: due.dueHasTime,
      // 🔴 태그를 건드리지 않았으면 키째 빠진다(`tagIdsFrom`). 키가 있으면 `patchTask`가 그 배열로
      // **덮어쓴다**.
      ...(tags.tagIds && { tagIds: tags.tagIds }),
    },
    "update",
  );
  if (!parsed.ok) {
    redirect(dashboardUrl({ view, tag, task: id, error: "title_required" }), RedirectType.replace);
  }

  const result = await patchTask(supabase, id, parsed.fields);
  if (!result.ok) {
    const error = ERROR_CODE[result.code] ?? "unknown";
    // 사라진 태스크의 패널로 되돌아가지 않는다.
    redirect(
      dashboardUrl({ view, tag, task: error === "not_found" ? undefined : id, error }),
      RedirectType.replace,
    );
  }

  backTo(dashboardUrl({ view, tag, task: id }));
}

/** 완료 ↔ 할 일(`DASH-10`). 상태는 `todo`·`done` 둘뿐이라 보낼 값도 둘뿐이다(제품 규칙). */
export async function setTaskStatus(formData: FormData): Promise<void> {
  await requireConsentedUser();
  const supabase = await createServerSupabase();
  const tag = field(formData, "tag");
  const view = viewOf(field(formData, "view"));
  const id = field(formData, "id");

  if (!isUuid(id)) redirect(dashboardUrl({ view, tag, error: "not_found" }), RedirectType.replace);

  const parsed = parseTaskFields({ status: field(formData, "status") }, "update");
  if (!parsed.ok) {
    redirect(dashboardUrl({ view, tag, task: id, error: "validation_failed" }), RedirectType.replace);
  }

  const result = await patchTask(supabase, id, parsed.fields);
  if (!result.ok) {
    const error = ERROR_CODE[result.code] ?? "unknown";
    redirect(
      dashboardUrl({ view, tag, task: error === "not_found" ? undefined : id, error }),
      RedirectType.replace,
    );
  }

  // 누르기 전에 열려 있던 패널로 돌아간다(`StatusToggle`의 `open`). 행에서 눌렀다고 그 태스크의
  // 패널을 새로 열지 않는다 — 목록을 훑으며 연달아 체크하는 동선이 패널에 끊기지 않게.
  const open = field(formData, "open");
  backTo(dashboardUrl({ view, tag, task: isUuid(open) ? open : undefined }));
}

/** 지운 태스크의 패널로 뒤로가기가 돌아가지 않도록 `replace`다. */
export async function deleteTask(formData: FormData): Promise<void> {
  await requireConsentedUser();
  const supabase = await createServerSupabase();
  const tag = field(formData, "tag");
  const view = viewOf(field(formData, "view"));
  const id = field(formData, "id");

  if (!isUuid(id)) redirect(dashboardUrl({ view, tag, error: "not_found" }), RedirectType.replace);

  const result = await removeTask(supabase, id);
  if (!result.ok) {
    redirect(
      dashboardUrl({ view, tag, error: ERROR_CODE[result.code] ?? "unknown" }),
      RedirectType.replace,
    );
  }

  redirect(dashboardUrl({ view, tag }), RedirectType.replace);
}

/* ──────────────────── 태그 관리 패널 (`DASH-6`의 화면, `L-P1-06`) ──────────────────── */

/**
 * 태그 액션 셋의 공통 규약.
 *
 * 🔴 **실패에도 `isTags: true`를 반드시 싣는다.** 빠뜨리면 `/dashboard?error=…`가 되어 패널이 닫히고,
 * 그 문구를 **그릴 사람이 없어 조용히 사라진다** — 사용자는 아무 일도 안 일어난 것처럼 본다.
 *
 * 🔴 **성공은 `backTo()`다.** 이름 변경은 주소가 `?tags=1`에서 `?tags=1`로 그대로라, `redirect()`만
 * 부르면 Next 16이 현재 라우트를 다시 그리지 않아 **바꿨는데 옛 이름이 보인다**(위 `backTo` 주석).
 *
 * 사유는 **`lib/api/tags.ts`의 `reason` 토큰을 그대로** URL에 싣는다(히스토리 되돌리기의 선례).
 * 문장은 화면이 `tagErrorMessage()`로 푼다 — `409` 응답의 `message`와 같은 표라 앱과 웹이 갈라지지
 * 않는다(`API-5`).
 */
async function tagContext() {
  await requireConsentedUser();
  return createServerSupabase();
}

export async function renameTagAction(formData: FormData): Promise<void> {
  const supabase = await tagContext();
  const tag = field(formData, "tag") || undefined;
  const view = viewOf(field(formData, "view"));
  const id = field(formData, "id");

  if (!isUuid(id)) {
    redirect(dashboardUrl({ view, tag, isTags: true, error: "TAG_NOT_FOUND" }), RedirectType.replace);
  }

  const result = await renameTag(supabase, id, formData.get("name"));
  if (!result.ok) {
    redirect(dashboardUrl({ view, tag, isTags: true, error: result.reason }), RedirectType.replace);
  }

  // 이름만 바뀌었으므로 id는 그대로다 — 보고 있던 필터가 풀릴 이유가 없다.
  backTo(dashboardUrl({ view, tag, isTags: true }));
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  const supabase = await tagContext();
  const tag = field(formData, "tag") || undefined;
  const view = viewOf(field(formData, "view"));
  const id = field(formData, "id");

  if (!isUuid(id)) {
    redirect(dashboardUrl({ view, tag, isTags: true, error: "TAG_NOT_FOUND" }), RedirectType.replace);
  }

  const result = await removeTag(supabase, id);
  if (!result.ok) {
    redirect(dashboardUrl({ view, tag, isTags: true, error: result.reason }), RedirectType.replace);
  }

  // 지운 태그를 보고 있었으면 필터를 푼다. 그대로 두면 "이 태그에 해당하는 할 일이 없습니다."만
  // 남고 사이드바에는 짚이는 항목이 없어(`전체`조차 안 짚인다) 어느 필터에 갇혔는지 알 수 없다.
  backTo(dashboardUrl({ view, tag: tag === id ? undefined : tag, isTags: true }));
}

export async function mergeTagsAction(formData: FormData): Promise<void> {
  const supabase = await tagContext();
  const tag = field(formData, "tag") || undefined;
  const view = viewOf(field(formData, "view"));
  const sourceId = field(formData, "sourceId");

  const result = await mergeTags(supabase, { sourceId, targetId: field(formData, "targetId") });
  if (!result.ok) {
    redirect(dashboardUrl({ view, tag, isTags: true, error: result.reason }), RedirectType.replace);
  }

  // 출발 태그를 보고 있었으면 **도착으로 따라간다.** 필터를 푸는 것과 다르다 — 보던 태스크들이
  // 사라진 게 아니라 그 자리에 그대로 있고 태그 이름만 바뀌었다. 도착 id는 이미 손에 있다.
  backTo(dashboardUrl({ view, tag: tag === sourceId ? result.tag.id : tag, isTags: true }));
}

/* ──────────────────── 확인 필요 (`DASH-11`, `L-P1-11`) ──────────────────── */

/**
 * [넘기기] — 실패한 생성 캡처를 태스크 없이 '확인 필요'에서 뺀다.
 *
 * **처리 표시만 하고 아무것도 지우지 않는다.** 히스토리에는 그대로 남는다. 없는 로그·남의 로그·
 * 이미 넘긴 로그는 `markLogHandled`가 오류 없이 0행으로 끝내므로 셋 다 같은 자리로 돌아간다 —
 * 존재 여부가 화면 차이로 새지 않는다.
 */
export async function skipLog(formData: FormData): Promise<void> {
  await requireConsentedUser();
  const supabase = await createServerSupabase();
  const id = field(formData, "id");

  if (isUuid(id)) await markLogHandled(supabase, id);

  backTo("/dashboard?view=review");
}
