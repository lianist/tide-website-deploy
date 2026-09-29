"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 사용법 단계의 화면 녹화. 원래 Framer 페이지의 영상 셋을 그대로 쓴다(`public/landing/`).
 *
 * - **화면에 보일 때만 받고 재생한다.** `preload="none"`으로 시작해 절반 이상 보이면 `play()`, 벗어나면
 *   멈춘다 — 세 편(≈2.8MB)을 첫 화면에서 한꺼번에 받지 않는다.
 * - **멈춤 버튼을 둔다.** 5초 넘게 스스로 움직이는 것은 멈출 수 있어야 한다(WCAG 2.2.2).
 * - **'동작 줄이기'에서는 스스로 재생하지 않는다.** 포스터(마지막 장면)가 보이고, 버튼으로만 튼다.
 *
 * 영상에는 소리가 없다(파일에서 오디오 트랙을 뺐다). 내용은 `label`이 글로 말한다.
 */
export function StepVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // 사용자가 직접 멈췄으면 다시 화면에 들어와도 스스로 재생하지 않는다.
  const userPaused = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) userPaused.current = true;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !userPaused.current) {
          video.play().catch(() => {});
        } else if (!entry?.isIntersecting) {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.play().catch(() => {});
    } else {
      userPaused.current = true;
      video.pause();
    }
  }

  return (
    <div className="relative">
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="block aspect-[16/10] w-full bg-subtle"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "영상 멈추기" : "영상 재생"}
        className="absolute right-3 bottom-3 inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-subtle"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          {playing ? (
            <>
              <rect x="2" y="1.5" width="3" height="9" rx="0.75" />
              <rect x="7" y="1.5" width="3" height="9" rx="0.75" />
            </>
          ) : (
            <path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l7-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5z" />
          )}
        </svg>
      </button>
    </div>
  );
}
