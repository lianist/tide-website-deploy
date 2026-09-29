import type { ReactNode } from "react";

import { TideLogo } from "@/components/icons";
import { cardClass } from "@/components/ui";

/**
 * 인증 화면 세 개가 공유하는 껍데기.
 *
 * 랜딩이나 설치 안내를 두지 않는다 — 사용자는 앱을 깐 상태에서 앱이 알려 준 주소로만 들어온다
 * (`docs/05-UI-Spec.md` §접근 전제).
 *
 * 폼은 흰 카드 위에 선다. 주색 배경(`bg-page`)과 흰 카드의 면 대비가 1.1:1뿐이라 **테두리가
 * 없으면 카드가 보이지 않는다** — `cardClass`가 그 테두리를 들고 있다(키트 3-6).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      {/*
        밝은 배경이므로 기본 락업이다. 둘레 여백은 심볼 지름의 0.5배 이상(키트 1-4).

        🔴 **여기에 '← 대시보드로' 링크를 두지 않는다**(사용자 결정 2026-09-25). 앱 웹뷰는 세션이
        없어 대시보드에서 이 화면으로 밀려온 것이라, 그 링크는 누르면 제자리로 돌아온다 — 앱 부서가
        세 화면에서 그것을 숨기고 있었다. 브라우저에서도 없애 앱이 덧칠할 것을 하나 줄였다.
      */}
      <div className="flex justify-center">
        <TideLogo height={24} />
      </div>

      <div className={`${cardClass} flex flex-col gap-4 px-6 py-8`}>{children}</div>
    </main>
  );
}
