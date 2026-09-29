import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "./icons";

/**
 * Tide 디자인 키트 v3.0(`tide-kit-v3.0/design-spec.md`)의 공통 조각. 규칙은
 * [`docs/08-Design-System.md`](../docs/08-Design-System.md).
 *
 * **전부 서버 컴포넌트다.** 이 파일에 `"use client"`가 없고 상태를 드는 것도 없다 — 저장소의
 * 유일한 클라이언트 컴포넌트는 `app/(app)/dashboard/realtime.tsx`이고 그것은 마크업을 내지 않는다
 * (`docs/03-Architecture.md` §설계 결정 21).
 *
 * `clsx`·`cva`를 넣지 않았다. 여기서 하는 일은 `Record` 조회와 문자열 결합뿐이고, 그건
 * `app/(app)/dashboard/ui.tsx`의 `cardClass()`가 이미 쓰던 방식이다.
 */

/* ─────────────────────────────── 버튼 (키트 4-2) ─────────────────────────────── */

export type Tone = "primary" | "secondary" | "text" | "quiet" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1 rounded-control text-button transition-colors " +
  "disabled:bg-subtle disabled:text-ink-disabled";

/**
 * 🔑 **인디고로 채운 버튼은 화면(또는 카드)마다 하나다**(키트 3-2). 두 번째 행동부터는
 * secondary·text·quiet를 쓴다. 좌우 패딩은 16px, Text만 8px이다.
 */
const TONE: Record<Tone, string> = {
  primary: "bg-brand px-4 text-on-brand hover:bg-brand-hover",
  secondary: "border border-line bg-surface px-4 text-ink hover:bg-subtle",
  text: "px-2 text-brand hover:bg-brand-subtle",
  quiet: "px-4 text-ink-secondary hover:bg-subtle",
  /*
    되돌릴 수 없는 행동(삭제)에만 쓴다. 채우지 않는 것은 키트 규칙 때문이다 — 채우면 화면에
    인디고가 아닌 채움 버튼이 하나 더 생긴다. 빨강은 여기와 마감·오류에만 쓰인다.

    `tone="text"` 위에 빨간 글자색을 덮는 방법을 쓰지 않았다. Tailwind는 클래스를 쓴 순서가
    아니라 생성된 CSS 순서로 이기고 지므로, 같은 프로퍼티를 두 번 적으면 어느 쪽이 이길지
    호출부가 알 수 없다.
  */
  danger: "px-2 text-error-ink hover:bg-error-bg",
};

const ON_BRAND_TONE = "text-on-brand-secondary hover:bg-white/14 hover:text-on-brand";

/** 인디고 면 위에 놓이는 버튼. 사이드바에서만 쓴다 — 흰색 덮개로만 반응한다. */
export const ON_BRAND_QUIET = `${BUTTON_BASE} h-8 px-3 ${ON_BRAND_TONE}`;

/**
 * 같은 버튼의 아이콘 전용판 — 40px 정사각형(HF-10, QA 요청으로 32px에서 키웠다). `ON_BRAND_QUIET`에
 * `w-*`·`px-0`을 덧대지 않고 따로 둔다: 같은 프로퍼티를 두 번 적으면 어느 쪽이 이길지 호출부가
 * 알 수 없다(위 `danger`의 주석과 같은 이유).
 */
export const ON_BRAND_ICON = `${BUTTON_BASE} size-10 ${ON_BRAND_TONE}`;

/** `lg`(48)는 랜딩 페이지의 다운로드 버튼만 쓴다 — 화면 전체의 주 행동이 하나뿐인 자리다. */
const SIZE = { lg: "h-12 min-w-40", md: "h-9 min-w-16", sm: "h-8 min-w-16" } as const;

/** 링크로 그려야 하는 행동(Google 계속하기, 패널 닫기, 새 태스크)이 쓴다. */
export function buttonClass(tone: Tone = "primary", size: keyof typeof SIZE = "md"): string {
  return `${BUTTON_BASE} ${SIZE[size]} ${TONE[tone]}`;
}

/**
 * 이 앱의 `<button>`은 **전부 폼 제출이다** — 클라이언트 JS가 없어 `onClick`이 있을 자리가 없다.
 * 그래서 `type`을 받지 않는다.
 *
 * 🔴 글자는 **문자열만** 받는다. 버튼 문구가 계약이라(`docs/05-UI-Spec.md` §마크업 계약) 아이콘이
 * 섞여 접근 이름이 바뀌는 길을 타입으로 막아 둔다.
 */
export function Button({
  tone = "primary",
  size = "md",
  className,
  children,
}: {
  tone?: Tone;
  size?: keyof typeof SIZE;
  className?: string;
  children: string;
}) {
  return (
    <button type="submit" className={`${buttonClass(tone, size)}${className ? ` ${className}` : ""}`}>
      {children}
    </button>
  );
}

/* ─────────────────────────────── 입력 (키트 3-4) ────────────────────────────── */

/** 테두리는 `border-line-input`(primary-500)이다 — 장식용 `border-line`(primary-300)과 다르다. */
export const inputClass =
  "w-full rounded-control border border-line-input bg-surface px-3 py-2 text-body text-ink " +
  "outline-none placeholder:text-ink-disabled focus:border-brand";

/**
 * 🔴 **라벨이 입력을 감싼다.** `getByLabel("이메일"/"비밀번호"/"제목"/"설명")`이 이 암묵 연결
 * 하나에 기대고 있다(`e2e/support/ui.ts`, `e2e/task-panel.spec.ts`). 라벨을 밖으로 빼려면
 * `htmlFor`/`id`가 필요하고, 그 순간 UI 스펙 여섯 개가 한꺼번에 떨어진다.
 *
 * 라벨 글자에 `*`·아이콘·콜론을 붙이지 않는다 — 접근 가능한 이름이 달라진다. 필수 표시가
 * 필요해지면 `required` 속성으로 말하고 글자는 건드리지 않는다.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-label text-ink-secondary">
      {label}
      {children}
    </label>
  );
}

/* ──────────────────────── 표면과 알림 (키트 3-5, 4-1, 4-3) ─────────────────── */

/**
 * 카드. 흰 표면 + `border-line` 1px이다. 🔑 **그림자를 쓰지 않는다** — 흰 카드와 주색 배경의
 * 면 대비가 1.1:1뿐이라 테두리가 그 일을 대신한다(키트 3-6).
 */
export const cardClass = "rounded-card border border-line bg-surface";

/** 폼 실패. 빨강이 쓰이는 두 자리 중 하나다(다른 하나는 마감). 아이콘은 글자를 늘리지 않는다. */
export function Alert({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-control bg-error-bg px-3 py-2 text-body-s text-error-ink"
    >
      <Icon name="alert" size={16} className="mt-1 shrink-0" />
      {children}
    </p>
  );
}

/**
 * 안내. 키트의 '확인 필요 배너'(4-3)와 같은 옅은 인디고 면을 쓴다.
 *
 * 아이콘을 넣지 않았다. 키트의 배너가 경고 아이콘을 다는 것은 **행동을 요구하기 때문**인데,
 * 여기 쓰이는 문구는 "메일을 보냈습니다"·"링크를 보내 드립니다"처럼 알리기만 한다. 경고
 * 아이콘을 달면 없는 긴급함이 생기고, 체크 아이콘을 달면 성공이 아닌 문구에 성공 표시가 붙는다.
 */
export function Notice({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="rounded-control border border-attention-line bg-attention-bg px-3 py-2 text-body-s text-attention-ink"
    >
      {children}
    </p>
  );
}

/* ────────────────────────── 사이드바 항목 (키트 4-3) ────────────────────────── */

/**
 * 인디고 사이드바 안에서 **누르는 항목**. 주요 메뉴(`AppShell`)와 태그 필터(`TagFilter`)가 같은
 * 물건을 쓴다 — 둘 다 "누르면 화면이 바뀌는 것"이고, 모양을 가르면 같은 뜻의 선택 표지가 두 벌이
 * 된다. 무엇을 고르는 네비인지는 감싸는 `<nav>`의 `aria-label`이 말한다.
 *
 * 선택 표시는 흰색 14% 덮개 + 왼쪽 흰색 3px 선이다(키트 4-3). 선을 `before:` 의사 요소로 그리는
 * 이유는 글자를 늘리지 않기 위해서다 — 링크의 접근 이름이 라벨 그대로여야 한다.
 *
 * 🔴 **왼쪽 3px 선은 `lg:`에서만 그린다.** 좁은 화면에서 가로 알약이 되면 막대가 글자 옆에 붙은
 * 부스러기처럼 보인다(실제 렌더에서 확인). 거기서는 흰색 덮개만으로 선택을 말한다.
 */
export function SidebarLink({
  href,
  current,
  badge,
  children,
}: {
  href: string;
  current: boolean;
  /**
   * 개수 배지(키트 4-3: 흰 원에 `secondary-700` 숫자, 10.6:1). 0이면 **그리지 않는다** — '확인
   * 필요'(`DASH-11`)가 받은편지함처럼 비워지는 목록이라 0은 "할 일 없음"이고, 배지가 서 있으면
   * 그 자체가 할 일처럼 읽힌다. 접근 이름에는 숫자가 그대로 붙는다("확인 필요 2").
   */
  badge?: number;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex items-center justify-between gap-2 ${
        current
          ? "relative rounded-control bg-white/14 px-3 py-2 text-body font-semibold whitespace-nowrap text-on-brand " +
            "lg:before:absolute lg:before:inset-y-2 lg:before:left-0 lg:before:w-[3px] lg:before:rounded-full lg:before:bg-on-brand"
          : "rounded-control px-3 py-2 text-body whitespace-nowrap text-on-brand-secondary hover:bg-white/8 hover:text-on-brand"
      }`}
    >
      {children}
      {badge ? (
        <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-caption font-semibold text-secondary-700">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/* ───────────────────────────── 배지·필·칩 (키트 4-3) ────────────────────────── */

/**
 * '자동' 배지 — 에이전트가 한 일이라는 표시. 어디에 있든 모양이 같다: 높이 20, 좌우 9px,
 * 앞에 `auto-dot` 점 6px, 글자 caption 600.
 */
export function AutoBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-auto-line bg-auto-bg px-2 text-caption font-semibold text-auto-ink">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-auto-dot" />
      {children}
    </span>
  );
}

/**
 * 상태 필. `status-bg` 위 `status-ink`(6.2:1). 언제나 글자가 들어간다.
 *
 * `tone="error"`는 히스토리의 실패 기록에만 쓴다(`L-P1-03`). **색만으로 말하지 않는다** — 필 안의
 * 글자가 "실패"라고 이미 적혀 있고 색은 그것을 한 번 더 말할 뿐이다(키트 3-5).
 */
export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "neutral" | "error";
}) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-caption ${
        tone === "error" ? "bg-error-bg text-error-ink" : "bg-status-bg text-status-ink"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * 태그 칩 — **읽는 것**이다. 누르는 것(사이드바의 필터 항목)과 모양을 갈라 둔다. 필터는 알약이나
 * 세로 목록, 태그는 납작한 사각이다(`docs/05-UI-Spec.md` §필터 칩과 태그 칩).
 *
 * 🔴 `<span>`이다. `<li>`로 그리면 태스크 `<li>` 안에 중첩돼 목록 순서를 보는 검증이 태그까지 센다.
 */
export function TagChip({ children }: { children: string }) {
  return (
    <span className="rounded-thumb bg-subtle px-2 py-1 text-caption text-ink-secondary">
      {children}
    </span>
  );
}

/* ───────────────────── 마감 표시 원 (키트 4-3의 원형 체크박스) ───────────────── */

/**
 * 마감 상태를 말하는 원(19px). 키트의 원형 체크박스 모양이다. 원 자체는 **그림**이고, 누르는
 * 일은 감싸는 `<button>`이 한다 — `app/(app)/dashboard/ui.tsx`의 `StatusToggle`(`DASH-10`).
 * 체크박스로 그리지 않는 것은 `getByRole("checkbox")`가 패널의 태그 체크박스만 잡아야 해서다.
 *
 * `aria-hidden`인 것도 같은 이유다 — 바로 옆 `<p>`가 "마감 지남 · 9월 22일"이라고 같은 사실을
 * 글자로 말하고 있어 스크린 리더에 두 번 읽힐 필요가 없다(키트 3-5: 상태를 색만으로 구분하지
 * 않는다 — 그래서 색과 글자가 같은 것을 두 번 말한다).
 */
const RING: Record<string, string> = {
  overdue: "border-urgent",
  today: "border-urgent",
  upcoming: "border-brand",
  none: "border-ring-idle",
  done: "border-brand bg-brand text-on-brand",
};

export function DueRing({ state }: { state: keyof typeof RING }) {
  return (
    <span
      aria-hidden="true"
      // `mt-0.5`(2px)는 간격 스케일 밖의 유일한 값이다. 20px 링을 행간 24px인 제목에 광학적으로
      // 맞추는 값이라 레이아웃 리듬이 아니라 컴포넌트 내부 정렬이다 — 키트도 배지 높이 20·점 6·
      // 패딩 9처럼 컴포넌트 내부 치수는 7단계 밖에서 따로 정한다(`docs/08-Design-System.md` §간격).
      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${RING[state]}`}
    >
      {state === "done" && <Icon name="check" size={12} />}
    </span>
  );
}
