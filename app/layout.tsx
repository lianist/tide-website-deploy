import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Tide",
  description: "화면 일부를 캡처하면 에이전트가 태스크를 만들어 준다.",
};

/**
 * 한글 웹폰트는 **버전을 박은 CDN**에서 받는다(`docs/03-Architecture.md` §설계 결정 23).
 *
 * 키트(`tide-kit-v3.0`)에는 데스크톱용 `.otf`/`.ttf`만 있고 웹폰트가 없다. 가변 woff2 전체를
 * 저장소에 넣으면 3.35MB가 늘고 사용자도 그만큼 받는다. Pretendard는 **동적 서브셋**이라
 * 실제로 화면에 뜬 글자의 조각만 받고, Wanted Sans는 제목에만 쓰여 split으로 충분하다.
 *
 * 주소에 `@v1.3.9`·`@v1.0.3`을 박은 것은 `package.json`에 캐럿을 쓰지 않는 것과 같은 이유다 —
 * 어제 통과한 화면이 오늘 저절로 바뀌지 않게 한다.
 *
 * 패밀리 이름은 키트의 `--font-body`/`--font-heading`이 가리키는 것과 글자까지 같다
 * (`'Pretendard Variable'` 45–920, `"Wanted Sans Variable"` 400–1000 — CDN의 @font-face 확인).
 */
const PRETENDARD =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const WANTED_SANS =
  "https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      {/*
        React 19가 `<link>`를 `<head>`로 끌어올린다(Next 16 §CSS). App Router에서 `<head>`를
        직접 쓰지 않는 이유다. `precedence`는 순서를 고정해 두는 표식이다.
      */}
      <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
      <link rel="stylesheet" href={PRETENDARD} precedence="default" />
      <link rel="stylesheet" href={WANTED_SANS} precedence="default" />

      {/*
        `font-*` 클래스를 달지 않는다 — `@theme`의 `--font-sans`가 키트의 본문 스택을 가리켜
        Tailwind preflight가 이미 문서 전체에 걸었다. 제목만 `font-heading`으로 갈아탄다.
      */}
      <body className="text-body antialiased">{children}</body>
    </html>
  );
}
