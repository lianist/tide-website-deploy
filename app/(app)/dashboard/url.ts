/**
 * 대시보드의 주소 한 벌 — 무엇이 열리는지와 어디로 돌아가는지.
 *
 * **`actions.ts`에 둘 수 없다.** `"use server"` 파일은 모든 export가 async 함수여야 해서 상수도
 * 동기 함수도 내보낼 수 없다 — `messages.ts`가 갈라져 있는 이유와 같다. 화면(`page.tsx`·`panel.tsx`)과
 * Server Action이 **같은 규칙**을 써야 하므로 둘 다 여기서 가져간다.
 */

export type PanelKind = "tags" | "new" | "task" | null;

/**
 * 보기(`DASH-9`) — 사이드바의 주요 메뉴가 고르는 목록.
 *
 * 🔑 **'오늘'은 주소에 싣지 않는다.** 맨 `/dashboard`가 곧 '오늘'이다 — 로그인 착지, 앱 알림의
 * `?task=`, 히스토리의 `?new=1&from=`처럼 **이미 밖으로 나간 주소가 한 글자도 안 바뀐 채** 첫
 * 화면으로 산다. 나머지는 `?view=all|done|review`다. 모르는 값은 '오늘'로 합류한다(주소창은 사람이
 * 치는 자리라 400을 내지 않는다).
 */
export const VIEWS = ["today", "all", "review", "done"] as const;
export type View = (typeof VIEWS)[number];

export function viewOf(value: Param): View {
  const raw = first(value);
  return VIEWS.find((view) => view === raw) ?? "today";
}

type Param = string | string[] | undefined;

/** 배열로 온 값은 없는 것으로 본다 — 주소창은 사람이 치는 자리라 400을 내지 않는다. */
function first(value: Param): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 🔑 **패널 슬롯은 하나다.** 오른쪽에 설 수 있는 것은 태그 관리·새 태스크·태스크 상세 셋인데
 * 자리가 하나뿐이라 순서가 필요하다: **`tags` → `new` → `task`**.
 *
 * 순서의 뜻은 "방금 누른 것이 이긴다"이다. [태그 관리]는 태스크를 열어 둔 채로도 [새 태스크]를
 * 열어 둔 채로도 누를 수 있어 가장 나중의 조작이고, `?task=`는 목록의 행을 누른 결과라 가장 오래됐다.
 *
 * 🔴 **우선순위가 적힌 곳은 이 함수뿐이다.** `page.tsx`에서 `isNew && !isTags` 같은 조건을 다시
 * 조립하지 않는다 — 그 순간 순서가 두 벌이 되고, 둘이 갈라지면 두 패널이 동시에 열려 아래의
 * `?error=` 규약(§주소의 `error`)까지 무너진다.
 *
 * `?tags`는 **존재만** 보고 `?new`는 값이 `1`일 때만 연다. `new`가 그렇게 굳어 있어(`L-P0-12`)
 * 맞춰 둔 것이고, 둘 다 링크로만 만들어지므로 실제로 갈리는 경우가 없다.
 */
export function panelOf(params: { tags?: Param; new?: Param; task?: Param }): PanelKind {
  if (params.tags !== undefined) return "tags";
  if (first(params.new) === "1") return "new";
  if (params.task !== undefined) return "task";
  return null;
}

/**
 * 대시보드 주소 한 벌. **보기와 태그 필터는 조작 내내 따라다녀야 한다.**
 *
 * 쿼리 순서(`view → tag → task → new → tags → from → error`)를 바꾸지 않는다 —
 * `e2e/task-panel.spec.ts`가 `?tag=X&task=Y$`를 정규식으로 고정하고 있다. `view`가 맨 앞인 것은
 * '오늘'에서는 아예 빠지기 때문이다 — 그때 뒤의 모양이 예전 주소와 한 글자도 다르지 않다.
 */
export function dashboardUrl(params: {
  view?: View;
  tag?: string;
  task?: string;
  isNew?: boolean;
  isTags?: boolean;
  from?: string;
  error?: string;
}): string {
  const query = new URLSearchParams();
  if (params.view && params.view !== "today") query.set("view", params.view);
  if (params.tag) query.set("tag", params.tag);
  if (params.task) query.set("task", params.task);
  if (params.isNew) query.set("new", "1");
  if (params.isTags) query.set("tags", "1");
  if (params.from) query.set("from", params.from);
  if (params.error) query.set("error", params.error);

  const suffix = query.toString();
  return suffix ? `/dashboard?${suffix}` : "/dashboard";
}
