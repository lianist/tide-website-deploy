import { headers } from "next/headers";
import type { ReactNode } from "react";

import { signOut } from "@/app/(auth)/actions";
import { Icon, TideLogo } from "@/components/icons";
import { ON_BRAND_ICON, SidebarLink } from "@/components/ui";
import { countNeedsReview } from "@/lib/api/job-logs";
import { createServerSupabase } from "@/lib/supabase/server";

import { type Platform, Shortcuts } from "./shortcuts";

/**
 * 로그인한 화면들의 공통 껍데기 — 인디고 사이드바 + 본문 2단(`L-DS-03`, `L-P1-03`).
 *
 * **`layout.tsx`가 아니라 컴포넌트다.** Next 16의 레이아웃은 네비게이션에서 다시 그려지지 않아
 * `pathname`도 `searchParams`도 읽을 수 없다(`node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/layout.md` §Query params·§Pathname). 그런데 이 사이드바가 그려야 하는 두
 * 표지가 정확히 그 둘에 걸려 있다 — 주요 메뉴의 `aria-current`(경로)와 태그 필터의 선택(`?tag=`).
 * 레이아웃으로 올리면 그 둘을 클라이언트 컴포넌트로 빼야 하고, 저장소의 `"use client"` 1건
 * 원칙(설계 결정 21)이 깨진다. 게다가 레이아웃이 태그 목록을 읽으면 화면을 옮겨 다닐 때 **옛
 * 목록이 남는다.** 컴포넌트로 두면 전부 서버에서 그려지고 마크업은 여전히 이 파일 한 곳뿐이다.
 *
 * 대가는 새 화면이 이것을 부르는 걸 잊으면 사이드바가 없다는 것이다(레이아웃은 강제한다).
 * 화면이 셋뿐이고 각 화면의 스펙이 사이드바를 보므로 감수한다. (사용자 결정 2026-09-24)
 */

/**
 * 주요 메뉴(`L-P1-03`, 보기는 `L-P1-10`).
 *
 * 📜 `L-P1-03`의 문장은 "**목업의 네비를 베끼지 않았다** — 키트 목업의 `오늘/전체/확인 필요/완료`는
 * 도치에 없는 개념이다(상태는 둘뿐이고 신뢰도 지표를 두지 않는다). 실제로 있는 화면만 적는다"였다.
 * 그 판단(없는 개념을 화면이 발명하지 않는다)은 옳았다. 이번에 개념이 **요구사항으로 생겼다** —
 * 보기(`DASH-9`)와 확인 필요(`DASH-11`, 생성이 실패한 캡처이지 신뢰도 지표가 아니다). 그래서 이제
 * 목업의 순서를 따른다: 보기들 → 히스토리 → 구분선 → 설정. 상태는 여전히 둘뿐이다 — 보기는 상태가
 * 아니라 **같은 두 상태를 자르는 방식**이다.
 *
 * 보기는 한 화면(`/dashboard`)의 `?view=`라 `current`가 경로가 아니라 **항목 키**다. '오늘'이
 * 맨 `/dashboard`인 이유는 `dashboard/url.ts`의 `VIEWS` 주석.
 *
 * 항목을 더하면 세 화면 모두에 따라온다 — `L-P1-07`이 '설정'을 그렇게 더했다.
 */
const MENU = [
  { key: "today", href: "/dashboard", label: "오늘" },
  { key: "all", href: "/dashboard?view=all", label: "전체" },
  // 개수 배지가 붙는 유일한 항목이다(`DASH-11`, `L-P1-12`).
  { key: "review", href: "/dashboard?view=review", label: "확인 필요" },
  { key: "done", href: "/dashboard?view=done", label: "완료" },
  { key: "history", href: "/history", label: "히스토리" },
] as const;

/** 구분선 아래. 목록이 아니라 계정의 일이라 떼어 둔다(목업). */
const MENU_FOOT = [{ key: "settings", href: "/settings", label: "설정" }] as const;

export type AppRoute = (typeof MENU)[number]["key"] | (typeof MENU_FOOT)[number]["key"];

/**
 * 단축키 안내가 처음 보여 줄 플랫폼. 브라우저가 말해 주는 것을 그대로 받는다 — Chromium 계열은
 * `Sec-CH-UA-Platform`을 늘 보내고(WebView2가 여기 해당한다), 안 보내는 브라우저는 User-Agent로
 * 가린다(macOS WKWebView의 UA에는 `Macintosh`가 들어 있다). 둘 다 아니면 Windows로 둔다.
 *
 * **틀려도 손해가 없다** — 사용자가 머리줄 옆 버튼으로 한 번에 바꾼다. 그래서 UA 판별을 더
 * 정교하게 만들지 않았다.
 */
async function initialPlatform(): Promise<Platform> {
  const header = await headers();
  const hint = header.get("sec-ch-ua-platform");
  if (hint) return hint.includes("macOS") ? "mac" : "windows";

  return /Mac|iPhone|iPad/.test(header.get("user-agent") ?? "") ? "mac" : "windows";
}

export async function AppShell({
  current,
  email,
  title,
  action,
  sidebar,
  needsReview,
  children,
}: {
  /** 지금 화면(대시보드는 보기). 주요 메뉴에서 이 항목에 `aria-current="page"`가 붙는다. */
  current: AppRoute;
  email: string | null | undefined;
  /** 본문 헤더의 `<h1>`. */
  title: string;
  /** 헤더 오른쪽의 주 행동(대시보드의 [+ 새 태스크]). 없는 화면도 있다. */
  action?: ReactNode;
  /** 사이드바의 화면별 조각(대시보드의 태그 필터). 없으면 구분선도 그리지 않는다. */
  sidebar?: ReactNode;
  /**
   * '확인 필요' 남은 건수. 대시보드는 배너에도 쓰려고 이미 세었으니 넘기고, 넘기지 않은 화면은
   * 여기서 센다 — 배지는 어느 화면에서든 보여야 한다(`DASH-11`).
   *
   * **이동할 때 갱신된다**(사용자 결정 2026-09-25). 실시간 구독은 여전히 `tasks`만 본다(설계
   * 결정 21) — 실패는 앱이 OS 알림으로 이미 말하므로 켜 둔 화면의 배지가 늦게 올라가도 놓치지 않는다.
   */
  needsReview?: number;
  children: ReactNode;
}) {
  const reviewCount = needsReview ?? (await countNeedsReview(await createServerSupabase()));

  return (
    // 키트가 말하는 주색 70 : 보조색 30의 면적 비율에서 인디고 30%를 사이드바가 거의 혼자 채운다.
    // 1024px 아래에서는 240px을 떼어 줄 폭이 없어 위쪽 가로 막대로 눕는다.
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/*
        🔴 `<aside>`를 쓰지 않는다. 상세 패널이 이미 이름 붙은 complementary라
        (`getByRole("complementary", { name: "태스크 상세" })`) 이름 없는 두 번째 complementary가
        생기면 랜드마크가 흐려진다. 사이드바의 뜻은 안에 든 `<nav>`가 이미 말한다.

        계정 정보와 로그아웃이 여기 있다. 제목과 같은 줄에 두었더니 좁은 화면에서 이메일이
        제목을 밀어 "대시 / 보드"로 쪼갰다(실측). 이제 `word-break: keep-all`이 그 쪼개짐을
        뿌리에서 막지만, 이메일은 여전히 제목과 경쟁하지 않는 자리에 있는 편이 낫다.
        🔴 이메일을 반응형으로 숨기지 않는다 — `e2e/auth.spec.ts`가 보여야 한다고 말한다.
      */}
      <div className="flex shrink-0 flex-col gap-6 bg-brand px-4 py-4 lg:w-60 lg:py-6">
        <div className="px-3">
          <TideLogo height={24} reverse />
        </div>

        <nav
          aria-label="주요 메뉴"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {MENU.map((item) => (
            <SidebarLink
              key={item.key}
              href={item.href}
              current={item.key === current}
              badge={item.key === "review" ? reviewCount : undefined}
            >
              {item.label}
            </SidebarLink>
          ))}
          {/* 좁은 화면에서는 가로 막대라 세로선, 넓은 화면에서는 가로선이다. */}
          <span aria-hidden="true" className="border-l border-white/14 lg:my-1 lg:border-t lg:border-l-0" />
          {MENU_FOOT.map((item) => (
            <SidebarLink key={item.key} href={item.href} current={item.key === current}>
              {item.label}
            </SidebarLink>
          ))}
        </nav>

        {/* 화면별 조각. 지금은 대시보드의 태그 필터 하나뿐이라 구분선을 여기서 붙인다. */}
        {sidebar && <div className="border-t border-white/14 pt-4">{sidebar}</div>}

        <Shortcuts initial={await initialPlatform()} />

        {/*
          🔴 **`lg:mt-auto`를 쓰지 않는다**(HF-04, 2026-09-26). 사이드바는 본문과 같은 높이로 늘어나므로
          아래로 밀어 두면 '전체'·히스토리처럼 긴 화면에서 **계정과 [로그아웃]이 페이지 맨 밑까지
          내려가** 로그아웃하려면 스크롤을 해야 했다(사용자 보고). 단축키 바로 밑에 붙여 둔다.

          [로그아웃]은 **아이콘 전용**이다 — 글자 네 자가 차지하던 폭이 이메일로 간다. 접근 이름은
          `aria-label`이 들고 아이콘 자신은 언제나 `aria-hidden`이라 이름에 섞이지 않는다. 그래서
          `getByRole("button", { name: "로그아웃" })`을 쓰는 검증 다섯이 그대로 산다.
        */}
        <div className="flex items-center justify-between gap-2 border-t border-white/14 px-3 pt-4">
          {/* 잘린 주소를 확인할 방법을 남긴다 — `<p>`의 `title`은 접근 이름에 끼어들지 않는다. */}
          <p
            title={email ?? undefined}
            className="min-w-0 truncate text-body-s text-on-brand-secondary"
          >
            {email}
          </p>
          <form action={signOut} className="shrink-0">
            <button type="submit" aria-label="로그아웃" className={ON_BRAND_ICON}>
              <Icon name="logout" size={24} />
            </button>
          </form>
        </div>
      </div>

      <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-8 px-6 py-8 lg:px-12 lg:py-12">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-h1 text-ink">{title}</h1>
          {action}
        </header>

        {children}
      </main>
    </div>
  );
}
