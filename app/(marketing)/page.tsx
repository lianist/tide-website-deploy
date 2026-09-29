import type { Metadata } from "next";

import { Closing, Facts, Faq, Footer, Header, Hero, HowItWorks } from "./ui";

/**
 * `/` — 랜딩 페이지(결정 기록 11). **정적 페이지다** — 요청마다 달라지는 것이 없고, 인증 흐름이
 * `/`로 떨어뜨리는 `?code=`·`?error=`는 `next.config.ts`의 `redirects()`가 여기 오기 전에 보낸다.
 * 이 파일이 `searchParams`·`cookies`를 읽기 시작하면 정적이 깨진다 — `npm run build` 출력에서
 * `/`가 `○`인지 본다.
 */
export const metadata: Metadata = {
  title: "Tide — 캡처를 바로 할 일로",
  description: "화면을 캡처하면 Tide가 할 일을 만들고, 끝난 일은 완료 처리해요. 단축키 두 개로 업무를 관리하세요.",
  openGraph: {
    title: "Tide — 캡처를 바로 할 일로",
    description: "화면을 캡처하면 Tide가 할 일을 만들고, 끝난 일은 완료 처리해요.",
    type: "website",
    locale: "ko_KR",
  },
  twitter: { card: "summary_large_image" },
};

export default function Landing() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Facts />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
