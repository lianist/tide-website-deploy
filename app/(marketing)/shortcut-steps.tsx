"use client";

import { type ReactNode, useState, useSyncExternalStore } from "react";

import { cardClass } from "@/components/ui";
import { KEYS, PLATFORM_NAME, type Platform } from "@/lib/shortcuts";

export interface Step {
  title: string;
  body: string;
  /** `KEYS[platform]`의 몇 번째 단축키인가. 단축키 없이 하는 단계는 `null`. */
  shortcut: number | null;
  visual: ReactNode;
}

/**
 * 방문자의 플랫폼. 랜딩은 정적 페이지라 서버가 요청 헤더를 읽을 수 없어(사이드바의 `initialPlatform`과
 * 다른 점) 브라우저에서 읽는다. 서버 렌더와 첫 하이드레이션은 `null` → macOS로 그려지고, 그 뒤
 * Windows 방문자에게만 한 번 바뀐다. 두 플랫폼의 키캡 수가 같아(3개) 바뀌어도 줄이 밀리지 않는다.
 */
function detectPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /win/i.test(hint) ? "windows" : "mac";
}
const subscribe = () => () => {};

/** 서버 렌더와 첫 하이드레이션에서는 `null`이다 — 그때는 호출부가 기본값(macOS)으로 그린다. */
export function useDetectedPlatform(): Platform | null {
  return useSyncExternalStore(subscribe, detectPlatform, () => null);
}

/** 키캡. 마지막 키(숫자)만 '자동' 배지의 옅은 인디고로 칠한다 — 두 단축키가 갈리는 자리다. */
function Keys({ keys }: { keys: string }) {
  const parts = keys.split("+");
  return (
    <p className="flex items-center gap-1 text-caption text-ink-secondary">
      {/* 보조기기는 앱과 같은 철자 한 줄을 읽는다. 키캡 조각은 그림이다. */}
      <span className="sr-only">{keys}</span>
      {parts.map((key, i) => (
        <span key={key} className="flex items-center gap-1" aria-hidden="true">
          {i > 0 && "+"}
          <kbd
            className={`num inline-flex h-8 min-w-8 items-center justify-center rounded-thumb border border-b-2 px-2 font-sans text-label ${
              i === parts.length - 1 ? "border-auto-line bg-auto-bg text-auto-ink" : "border-line bg-surface text-ink"
            }`}
          >
            {key}
          </kbd>
        </span>
      ))}
    </p>
  );
}

/**
 * 사용법 세 단계와 플랫폼 토글. 단계의 그림(`visual`)은 서버에서 그려 넘겨받는다 — 이 파일이 JS로
 * 싣는 것은 토글과 키캡뿐이다.
 */
export function ShortcutSteps({ title, steps }: { title: string; steps: readonly Step[] }) {
  const detected = useDetectedPlatform();
  const [chosen, setChosen] = useState<Platform | null>(null);
  const platform = chosen ?? detected ?? "mac";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="how-title" className="font-heading text-display text-ink">
          {title}
        </h2>
        <div role="group" aria-label="플랫폼" className="flex gap-1 rounded-control border border-line bg-surface p-1">
          {(Object.keys(PLATFORM_NAME) as Platform[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setChosen(name)}
              aria-pressed={platform === name}
              className={`h-8 rounded-thumb px-3 text-button transition-colors ${
                platform === name ? "bg-subtle text-ink" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {PLATFORM_NAME[name]}
            </button>
          ))}
        </div>
      </div>

      {/*
        한 단계가 한 줄이다 — 글은 왼쪽, 녹화는 오른쪽. 세 칸 카드로 두면 1440×900 녹화가 300px로
        줄어 화면 속 글자를 읽을 수 없다. 줄마다 좌우를 뒤집지 않는다(눈이 같은 자리에서 글을 찾는다).
      */}
      <ol className="flex flex-col gap-12">
        {steps.map((step, i) => (
          <li key={step.title} className="grid items-center gap-6 md:grid-cols-[2fr_3fr] md:gap-12">
            <div className="flex flex-col gap-2">
              <p className="num text-label text-brand">{i + 1}</p>
              <h3 className="font-heading text-h2 text-ink">{step.title}</h3>
              <p className="text-body text-ink-secondary">{step.body}</p>
              <div className="pt-2">
                {step.shortcut === null ? (
                  <p className="text-caption text-ink-secondary">대시보드 · 히스토리</p>
                ) : (
                  <Keys keys={KEYS[platform][step.shortcut]?.keys ?? ""} />
                )}
              </div>
            </div>
            <div className={`${cardClass} overflow-hidden`}>{step.visual}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
