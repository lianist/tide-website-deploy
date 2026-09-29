import Link from "next/link";

import { Icon } from "@/components/icons";
import { AutoBadge, DueRing, ON_BRAND_QUIET, SidebarLink, TagChip } from "@/components/ui";
import { UNCATEGORIZED } from "@/lib/api/tags";
import type { Database } from "@/lib/supabase/database.types";
import { describeDue, type DueState } from "@/lib/time";

import { setTaskStatus } from "./actions";
import { dashboardUrl, type View } from "./url";

/**
 * 대시보드 조각들. 전부 서버에서 그려진다 — 이 파일에 클라이언트 컴포넌트가 없다. 저장소의 유일한
 * `"use client"`는 `realtime.tsx`이고, 그것은 데이터를 들지 않는다(설계 결정 21).
 *
 * `app/(auth)/ui.tsx`와 다른 점 하나: 거기서는 반복되는 것이 스타일뿐이라 스타일만 모았지만,
 * 여기는 **태스크 행이 N번 반복되는 실제 구조**라 컴포넌트가 된다. 대신 내보내는 것은 둘뿐이고
 * `TaskItem`은 안에 둔다 — 바깥에서 부를 자리가 없고, 내보내면 그만큼 계약이 는다.
 */

/** 화면에 필요한 것만. `lib/api/tasks.ts`의 `toTaskPayload`가 내는 모양의 부분집합이다. */
interface TaskView {
  id: string;
  title: string;
  status: "todo" | "done";
  dueAt: string | null;
  dueHasTime: boolean;
  /** 에이전트가 만든 것인지 사람이 만든 것인지. '자동' 배지가 이 값 하나로 갈린다. */
  source: Database["public"]["Enums"]["source_kind"];
  tags: { id: string; name: string }[];
}

/**
 * 강조를 **글자로도** 말한다. 색만 쓰면 색각 이상 사용자에게 강조가 전달되지 않는다. 절대 날짜는
 * 접두사 뒤에 그대로 남겨 모든 행의 같은 자리에 오게 한다 — 눈이 한 줄로 훑을 수 있다.
 */
const DUE_PREFIX: Record<DueState, string | null> = {
  overdue: "마감 지남",
  today: "오늘 마감",
  upcoming: null,
};

/**
 * 키트는 마감 당일과 지남을 둘 다 `error-600`으로 묶지만, 도치는 두 단계를 색으로도 갈라 왔다.
 * 같은 램프의 한 단계 아래(`overdue` = error-700)로 가른다 — 새 색조를 들이지 않으면서 "이미
 * 늦었다"가 "오늘까지다"보다 진하다는 순서도 맞는다. 흰 카드 위 대비는 7.3 / 5.0 / 5.4로 전부 AA다
 * (`docs/08-Design-System.md` §키트에서 한 발 나간 것 하나).
 */
const DUE_CLASS: Record<DueState, string> = {
  overdue: "text-overdue",
  today: "text-urgent",
  upcoming: "text-ink-secondary",
};

/** 원형 링이 말하는 마감 단계. 완료 섹션은 단계를 따지지 않고 채운 원이다. */
export type RingState = DueState | "none" | "done";

/**
 * 태스크 카드.
 *
 * **미완료 행의 hover에 배경을 쓰지 않는다.** 완료한 행이 배경(`bg-subtle`)으로 구분되므로,
 * 미완료 행에 마우스를 올리면 그 순간 완료된 것처럼 보인다(실제 렌더에서 확인). hover는 배경이
 * 아니라 테두리로 말한다 — 완료 섹션이 쓰지 않는 신호다.
 *
 * 완료 행은 테두리가 없지만 `border-transparent`를 깔아 둔다. 열렸을 때만 테두리가 생기면
 * 카드가 1px 밀린다.
 *
 * `L-P1-09`부터 카드는 `<li>`가 입는다 — 안에 **완료 버튼과 상세 링크가 형제로** 서기 때문이다.
 */
const CARD_CLASS = "flex items-start gap-3 rounded-card border px-4 py-3 transition-colors";

/** 배경(완료 여부)과 테두리(열림·hover)를 갈라 조립한다 — 열려도 완료의 눌린 면은 그대로 남는다. */
function cardClass(emphasized: boolean, open: boolean): string {
  const tone = emphasized ? "bg-surface " : "bg-subtle ";
  const edge = open
    ? "border-brand"
    : emphasized
      ? "border-line hover:border-line-input"
      : "border-transparent";
  return `${CARD_CLASS} ${tone}${edge}`;
}

/**
 * 완료 표시 — 누르면 완료·미완료가 뒤집힌다(`DASH-10`). 행과 상세 패널이 **같은 물건**을 쓴다.
 *
 * 🔴 **행 링크(`<a>`) 안에 넣지 않는다.** 인터랙티브 요소 중첩은 HTML이 금지한다 — 그래서 행의
 * `<li>` 안에서 이 폼과 상세 링크가 형제로 선다.
 *
 * 폼 제출이라 클라이언트 컴포넌트가 늘지 않는다. 결과는 `setTaskStatus`가 주소로 돌려준다 —
 * `open`은 **누른 뒤 다시 열어 둘 패널**이다. 행에서 누르면 그때 열려 있던 패널(없으면 없음),
 * 패널에서 누르면 그 태스크 자신이다.
 *
 * 접근 가능한 이름이 **할 일**을 말하고(`완료로 표시`/`미완료로 되돌리기`), `aria-pressed`가
 * 지금 상태를 싣는다. 행에서는 이름 앞에 제목을 붙인다(`named`) — 목록에는 같은 버튼이 N개 선다.
 * 패널에서는 붙이지 않는다. 버튼이 하나뿐이고, 붙이면 제목에 "제목"이 든 태스크에서
 * `getByLabel("제목")`이 입력 칸과 이 버튼을 함께 잡는다(실제로 깨졌다).
 * 링(`DueRing`)은 여전히 `aria-hidden`이고 버튼 안에 글자가 없다 — 행에 콜론이 없어야 한다는
 * 검증과 "행 안 첫 `<p>`가 마감 줄"이라는 전제가 그대로 산다.
 */
export function StatusToggle({
  task,
  ring,
  tag,
  view,
  open,
  named = false,
}: {
  task: { id: string; title: string; status: "todo" | "done" };
  ring: RingState;
  tag: string | null;
  view: View;
  open: string | null;
  named?: boolean;
}) {
  const done = task.status === "done";
  const action = done ? "미완료로 되돌리기" : "완료로 표시";

  return (
    <form action={setTaskStatus} className="flex shrink-0">
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="status" value={done ? "todo" : "done"} />
      <input type="hidden" name="tag" value={tag ?? ""} />
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="open" value={open ?? ""} />
      <button
        type="submit"
        aria-label={named ? `${task.title} ${action}` : action}
        aria-pressed={done}
        className="cursor-pointer rounded-full"
      >
        <DueRing state={ring} />
      </button>
    </form>
  );
}

/**
 * 태그 구획을 그릴지. '미분류' 하나뿐이면 **구획째** 숨긴다 — 거를 것도 관리할 것도 없다('미분류'는
 * 이름 변경·삭제·병합 출발이 막혀 있다). 피드백이 본 "전체/미분류"가 이 모습이었다(`L-P1-10`).
 *
 * `TagFilter`가 `null`을 돌려주는 식으로 숨기지 않는다 — 셸이 조각을 받으면 구분선을 먼저 그어
 * **빈 칸이 남는다**(실제 렌더에서 확인). 페이지가 이것을 물어 조각 자체를 넘기지 않는다.
 */
export function showsTagFilter(tags: { name: string }[]): boolean {
  return tags.some((tag) => tag.name !== UNCATEGORIZED);
}

/**
 * 태그 필터(`DASH-2`). 고른 태그를 URL에 싣는다 — 클라이언트 상태를 만들지 않고, 주소만으로
 * 같은 화면을 다시 열 수 있다. 쿼리 이름은 `tag`다(API의 `tagId`와 다르다. 주소창에 사람이 친다).
 *
 * `L-DS-03`에서 **인디고 사이드바 안으로 옮겼다.** `getByRole("navigation", { name })`은 문서
 * 어디에 있든 찾으므로 계약은 그대로다. 오히려 안전해졌다 — 섹션 안에서 태그 이름을 찾는 검증
 * (`realtime.spec.ts`)과 더 멀어졌다.
 *
 * `L-P1-03`에서 **항목의 모양이 `SidebarLink`로 올라갔다.** 주요 메뉴와 같은 물건을 쓴다 — 둘 다
 * 누르면 화면이 바뀌는 것이고, 무엇을 고르는 네비인지는 `<nav>`의 이름이 말한다. 여기 남은 것은
 * "어떤 항목이 있고 무엇이 골라졌나"뿐이다.
 *
 * 🔴 **이 `<nav>`는 화면에 정확히 하나여야 한다.** 좁은 화면용과 넓은 화면용을 따로 그리면
 * Playwright strict mode가 둘을 잡아 필터 검증이 전부 깨진다. 마크업은 하나, `lg:` 분기로만 칠한다.
 */
export function TagFilter({
  tags,
  selected,
  view,
}: {
  tags: { id: string; name: string }[];
  selected: string | null;
  /** 지금 보기. 태그는 보기를 **다시 좁힌다**(`DASH-9`) — 태그를 골라도 보기가 풀리지 않는다. */
  view: View;
}) {
  return (
    /*
      접는다(HF-12). 태그가 늘면 사이드바가 길어져 계정과 [로그아웃]이 첫 화면 밖으로 밀렸다 —
      HF-04가 `mt-auto`를 걷어 내며 고친 것과 같은 증상이 이번엔 목록 길이로 돌아왔다. 네이티브
      `<details>`라 클라이언트 JS가 없다(`"use client"` 1건 원칙, 설계 결정 21).

      **태그가 골라져 있으면 열어 둔다.** 닫아 두면 본문이 왜 좁혀졌는지가 사이드바에서 사라진다.
      `open`은 서버가 정하는 초깃값일 뿐이라, 사용자가 접은 것을 같은 값의 재렌더가 되돌리지 않는다.

      🔴 닫힌 `<details>` 안은 접근성 트리에서 빠진다 — "태그 필터" 네비를 찾는 검증은 먼저 머리줄을
      눌러 연다(`e2e/support/ui.ts`의 `openTagFilter`).
    */
    <div className="relative">
      <details open={selected !== null} className="group">
        {/*
          머리줄이 `<summary>`다. [관리]는 그 안에도, `<details>` 안에도 두지 않는다 — `<summary>`는
          버튼 역할이라 안의 링크는 누르면 이동과 접기가 함께 일어나고, 닫힌 `<details>`는 `<summary>`
          말고 **모든 자식을 숨긴다**(첫 실행에서 [관리]가 같이 사라졌다). 바깥 래퍼의 형제로 두고
          머리줄 오른쪽에 겹쳐 놓아, 접혀 있어도 [관리]는 늘 보인다. 높이는 둘 다 `h-8`이라 줄이 맞는다.

          머리줄이 따로 있는 이유는 `L-P1-03`이 관찰한 것 — 주요 메뉴와 여기 '전체'가 같은 흰 덮개를
          달고 나란히 서서 **위계가 평평해 보였다.** 선례는 바로 아래 '전역 단축키' 구획이다.
          [관리]가 `<nav>` **바깥**인 것은 필터가 아니라 패널을 여는 행동이어서다(🔴 위의 규칙).

          🔴 [관리]에 `buttonClass("text")`를 쓰면 **안 보인다.** 그 톤은 `text-brand`(인디고)인데
          사이드바 면도 `bg-brand`다 — 빌드도 lint도 grep 게이트도 잡지 않고 렌더만 사라진다.
          인디고 면 위에서 누르는 것은 `ON_BRAND_QUIET` 하나뿐이다.
        */}
        {/* 아래 '전역 단축키'와 같은 `text-label`이다 — 나란히 선 두 구획의 제목이 한 벌이어야 한다. */}
        <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-control px-3 text-label text-on-brand hover:bg-white/8 [&::-webkit-details-marker]:hidden">
          <Icon name="chevron-right" size={16} className="transition-transform group-open:rotate-90" />
          태그
        </summary>
        {/* `<details>`를 flex로 두지 않고 간격을 여기서 준다 — details의 flex 배치는 브라우저마다 갈린다. */}
        <nav
          aria-label="태그 필터"
          className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          <SidebarLink href={dashboardUrl({ view })} current={selected === null}>
            전체
          </SidebarLink>
          {tags.map((tag) => (
            <SidebarLink
              key={tag.id}
              href={dashboardUrl({ view, tag: tag.id })}
              current={tag.id === selected}
            >
              {tag.name}
            </SidebarLink>
          ))}
        </nav>
      </details>
      <Link
        href={dashboardUrl({ view, tag: selected ?? undefined, isTags: true })}
        className={`${ON_BRAND_QUIET} absolute top-0 right-0`}
      >
        관리
      </Link>
    </div>
  );
}

/**
 * 한 섹션 — 지금 보기의 목록 하나(`DASH-9`). 비어 있어도 그린다 — 빈 목록과 "안 보여 주는 것"이
 * 구분된다.
 *
 * `L-P1-10` 전에는 '할 일'·'완료' 두 섹션이 한 화면에 섰고 섹션이 강조 여부를 정했다. 이제 '오늘'
 * 보기에 미완료와 (오늘 마감인) 완료가 섞이므로 **강조는 행이 자기 상태로 정한다.**
 */
export function TaskSection({
  title,
  tasks,
  empty,
  timeZone,
  now,
  tag,
  view,
  openTaskId,
}: {
  title: string;
  tasks: TaskView[];
  empty: string;
  timeZone: string;
  now: Date;
  /** 지금 걸린 태그 필터. 행을 눌러 패널을 열어도 필터가 풀리지 않도록 링크에 싣는다. */
  tag: string | null;
  /** 지금 보기. 태그와 같은 이유로 링크에 싣는다. */
  view: View;
  /** 지금 패널이 열려 있는 태스크. 목록에서 그 행을 짚어 준다. */
  openTaskId: string | null;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 font-heading text-h2 text-ink">
        {title}
        <span className="num text-body text-ink-secondary">{tasks.length}</span>
      </h2>

      {tasks.length === 0 ? (
        <p className="text-body-s text-ink-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              timeZone={timeZone}
              now={now}
              tag={tag}
              view={view}
              openTaskId={openTaskId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 한 행. 강조 여부를 **스스로 판정한다** — 어느 단계인지는 데이터의 사실이지 호출부의 취향이
 * 아니다. 분류는 `data-due`로 마크업에 적는다. 테스트가 붙잡을 것은 "마감 지남으로 분류되었다"
 * 이지 색번호가 아니라서, 팔레트를 바꿔도 검증이 살아남는다.
 */
function TaskItem({
  task,
  timeZone,
  now,
  tag,
  view,
  openTaskId,
}: {
  task: TaskView;
  timeZone: string;
  now: Date;
  tag: string | null;
  view: View;
  openTaskId: string | null;
}) {
  const open = task.id === openTaskId;
  // 강조는 미완료의 것이다(`DASH-1`). 완료된 태스크에 "마감 지남"은 거짓이다.
  const emphasized = task.status === "todo";
  const due = task.dueAt ? describeDue(task.dueAt, task.dueHasTime, timeZone, now) : null;
  const prefix = due && emphasized ? DUE_PREFIX[due.state] : null;
  const href = dashboardUrl({ view, tag: tag ?? undefined, task: task.id });
  const ring: RingState = emphasized ? (due ? due.state : "none") : "done";
  // 에이전트가 만든 것에만 '자동'을 단다. `manual`이 아닌 나머지(캡처·메일)는 전부 에이전트의 일이다.
  const auto = task.source !== "manual";

  return (
    <li
      // 완료 섹션에는 속성 자체를 붙이지 않는다 — 강조는 미완료의 것이다(`DASH-1`).
      data-due={emphasized ? (due ? due.state : "none") : undefined}
      className={cardClass(emphasized, open)}
    >
      <StatusToggle task={task} ring={ring} tag={tag} view={view} open={openTaskId} named />

      {/*
        카드의 나머지 전체가 상세 패널로 가는 링크다(`DASH-3`). `data-due`는 `<li>`에 남긴다 — 마크업
        계약이 그 자리를 가리키고, 검증도 거기서 출발한다(`docs/05-UI-Spec.md` §마크업 계약).

        🔴 **행에 보이는 글자를 함부로 더하지 않는다.** 접근 가능한 이름은 `aria-label`로만 준다.
        "열기" 같은 텍스트를 넣으면 "날짜만 있는 마감은 시각을 감춘다"(행에 콜론이 없어야 한다)와
        태그 유무를 행 텍스트로 보는 검증이 함께 깨진다. 이번에 더한 '자동' 두 글자는 콜론이 없고
        태그 이름과도 겹치지 않아 통과한다 — 다음에 무언가를 더할 때도 이 두 줄을 먼저 확인한다.

        DOM 순서는 완료 버튼(링 span) → 링크(본문 div(h3 → 마감 p → 태그 p) → 배지 span)다.
        **링과 배지가 `<span>`인 것이 중요하다** — `<p>`로 그리면 "행 안 첫 번째 `<p>`가 마감 줄"
        이라는 전제가 깨져 마감 3색 검증이 엉뚱한 요소를 집는다.
      */}
      <Link
        href={href}
        aria-label={`${task.title} 상세`}
        // 필터 칩과 같은 표지다 — 지금 열려 있는 것이 무엇인지 마크업이 말한다.
        aria-current={open ? "page" : undefined}
        className="flex min-w-0 flex-1 items-start gap-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* 제목이 주인공이다 — 강조된 마감이 색으로 튀는 만큼 제목의 무게를 올려 둔다. */}
          <h3
            className={`font-heading text-h3 ${
              emphasized ? "text-ink" : "text-ink-secondary line-through"
            }`}
          >
            {task.title}
          </h3>

          {due && (
            <p
              className={`num text-body-s ${emphasized ? DUE_CLASS[due.state] : "text-ink-disabled"}`}
            >
              {prefix ? <span className="font-semibold">{prefix} · </span> : null}
              {due.label}
            </p>
          )}

          {task.tags.length > 0 && (
            // 태그를 <li>로 그리지 않는다. 태스크 <li> 안에 중첩되면 목록 순서를 보는 검증이
            // 태그까지 함께 잡는다.
            <p className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <TagChip key={tag.id}>{tag.name}</TagChip>
              ))}
            </p>
          )}
        </div>

        {auto && <AutoBadge>자동</AutoBadge>}
      </Link>
    </li>
  );
}
