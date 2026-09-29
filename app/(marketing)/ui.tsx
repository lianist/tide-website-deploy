import Link from "next/link";

import { TideLogo, TideSymbol } from "@/components/icons";
import { cardClass } from "@/components/ui";

import { Download } from "./download";

import { CLOSING, CONTACT_EMAIL, FACTS, FAQ, FOOTER, HERO, HOW, VIDEOS } from "./messages";
import { ShortcutSteps } from "./shortcut-steps";
import { StepVideo } from "./step-video";

/**
 * 랜딩 페이지의 섹션들(`docs/05-UI-Spec.md` §랜딩 페이지). 전부 서버 컴포넌트다 — JS가 실리는 것은
 * 섬 셋뿐이다: 플랫폼 토글(`shortcut-steps.tsx`), 다운로드 버튼(`download.tsx`), 녹화 재생(`step-video.tsx`).
 *
 * 🔑 **제품은 실제 앱의 화면 녹화로 보여 준다**(`VIDEOS`). 히어로는 캡처 → 알림 → 대시보드 한 편,
 * 사용법은 단계마다 한 편이다.
 *
 * 🔑 **채운 인디고 버튼은 한 화면에 하나다**(키트 3-2). 첫 화면에서는 히어로의 다운로드 버튼이 그
 * 하나라서, 머리줄에는 채운 버튼을 두지 않는다.
 */

const CONTAINER = "mx-auto w-full max-w-5xl px-6 lg:px-12";
const SECTION = "py-section-sm md:py-section";

/* ─────────────────────────────── 머리줄 ─────────────────────────────── */

export function Header() {
  const link = "text-body text-ink-secondary transition-colors hover:text-ink";
  return (
    <header className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
      <Link href="/" aria-label="Tide 홈">
        <TideLogo height={24} />
      </Link>
      <nav aria-label="주요" className="flex items-center gap-6">
        <a href="#how" className={`${link} hidden md:inline`}>
          사용법
        </a>
        <a href="#faq" className={`${link} hidden md:inline`}>
          자주 묻는 질문
        </a>
        <Link href="/login" className={link}>
          로그인
        </Link>
      </nav>
    </header>
  );
}

/* ─────────────────────────────── 히어로 ─────────────────────────────── */

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`${CONTAINER} flex flex-col items-center gap-12 pt-12 md:pt-section`}>
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <h1 id="hero-title" className="font-heading text-display text-balance text-ink md:text-display-l">
          {HERO.title}
        </h1>
        <p className="text-lead text-ink-secondary">{HERO.lead}</p>
      </div>
      <Download id="download" />
      <HeroVideo />
    </section>
  );
}

/**
 * 히어로 녹화 — 메신저의 요청을 캡처하면 알림이 뜨고 대시보드에 태스크가 생기는 10초. 제품의 이야기
 * 전체가 이 한 편에 있어서 첫 화면에 둔다. 사용법 1단계와 같은 파일이라 한 번만 받는다(브라우저 캐시).
 */
function HeroVideo() {
  const video = VIDEOS[0];
  return (
    <figure className="w-full">
      <div className={`${cardClass} overflow-hidden`}>
        <StepVideo src={video.src} poster={video.poster} label={video.label} />
      </div>
      <figcaption className="mt-3 text-center text-caption text-ink-secondary">
        캡처로 만들어진 태스크에는 ‘자동’ 배지가 붙어요.
      </figcaption>
    </figure>
  );
}

/* ─────────────────────────────── 사용법 ─────────────────────────────── */

export function HowItWorks() {
  const steps = HOW.steps.map((step, i) => {
    const video = VIDEOS[i]!;
    return { ...step, visual: <StepVideo src={video.src} poster={video.poster} label={video.label} /> };
  });
  return (
    <section id="how" aria-labelledby="how-title" className={`${CONTAINER} ${SECTION} scroll-mt-4`}>
      <ShortcutSteps title={HOW.title} steps={steps} />
    </section>
  );
}

/* ─────────────────────────────── 사실 셋 ─────────────────────────────── */

export function Facts() {
  return (
    <section aria-label="Tide가 지키는 것" className="border-y border-line bg-surface">
      <dl className={`${CONTAINER} grid gap-8 py-12 md:grid-cols-3`}>
        {FACTS.map(({ value, label }) => (
          <div key={value} className="flex flex-col gap-1">
            <dt className="text-body text-ink-secondary">{label}</dt>
            <dd className="num order-first font-heading text-display text-brand">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ─────────────────────────────── 자주 묻는 질문 ─────────────────────────────── */

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={`${CONTAINER} ${SECTION} scroll-mt-4`}>
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <h2 id="faq-title" className="font-heading text-display text-ink">
          자주 묻는 질문
        </h2>
        <div className="flex flex-col border-t border-line">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-heading text-h3 text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden="true"
                  className="text-h2 font-normal text-ink-secondary transition-transform duration-150 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-4 text-body text-ink-secondary">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 마무리 ─────────────────────────────── */

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className={`${CONTAINER} pb-section-sm md:pb-section`}>
      <div className={`${cardClass} flex flex-col items-center gap-6 px-6 py-12 text-center`}>
        <TideSymbol size={48} />
        <h2 id="closing-title" className="font-heading text-display text-balance text-ink">
          {CLOSING.title}
        </h2>
        <Download />
      </div>
    </section>
  );
}

/* ─────────────────────────────── 바닥글 ─────────────────────────────── */

export function Footer() {
  const link = "text-body-s text-ink-secondary transition-colors hover:text-ink";
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${CONTAINER} flex flex-col gap-6 pt-12 pb-6 md:flex-row md:items-start md:justify-between`}>
        <div className="flex flex-col gap-2">
          <TideLogo height={20} />
          <p className="text-body-s text-ink-secondary">{FOOTER.tagline}</p>
        </div>
        <nav aria-label="바닥글" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/privacy" className={link}>
            개인정보처리방침
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            {CONTACT_EMAIL}
          </a>
        </nav>
      </div>
      <div className={`${CONTAINER} flex flex-wrap items-center gap-4 pb-6`}>
        {BADGES.map(({ src, alt }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={alt} height={44} className="h-11 w-auto" />
        ))}
      </div>
      <p className={`${CONTAINER} num pb-8 text-caption text-ink-secondary`}>© 2026 Tide</p>
    </footer>
  );
}

/** 바닥글 배지 — 순서 고정: Kiro · Bedrock · Microsoft Store · macOS. 원본 SVG는 모두 높이 44. */
const BADGES = [
  { src: "/badges/tide-badge-built-with-kiro-plain.svg", alt: "Built with Kiro" },
  { src: "/badges/tide-badge-powered-by-bedrock-plain.svg", alt: "Powered by AWS Bedrock" },
  { src: "/badges/tide-badge-microsoft-store-plain.svg", alt: "Microsoft Store에서 받기" },
  { src: "/badges/tide-badge-macos-plain.svg", alt: "macOS용 다운로드" },
] as const;
