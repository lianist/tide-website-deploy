"use client";

import { Fragment, useState } from "react";

import { KEYS, PLATFORM_NAME as NAME, type Platform } from "@/lib/shortcuts";

export type { Platform };

/**
 * 버튼의 **접근 이름**(전체 이름)과 **보이는 이름**(줄인 이름)을 따로 둔다.
 *
 * 줄여야 하는 이유는 폭이다 — 머리줄이 쓸 수 있는 폭은 184px(사이드바 240 − 셸 패딩 32 − 구획
 * 패딩 24)인데, `전역 단축키` + `macOS` + `Windows`를 전체 이름으로 세우면 Pretendard에서 189px,
 * 폰트가 아직 안 온 대체 글꼴에서는 192px이다(실측). **그래서 `flex-wrap`이 버튼을 다음 줄로
 * 떨어뜨렸다** — 머리줄 옆에 두려고 만든 배치가 실제로는 제목 아래 한 줄로 보였다(사용자 보고,
 * 2026-09-26). 줄인 이름이면 대체 글꼴에서도 158px이라 어느 쪽으로도 넘치지 않는다.
 *
 * `aria-label`이 전체 이름을 들고 있어 보조기기와 검증(`getByRole("button", { name: "Windows" })`)은
 * 전체 이름을 그대로 읽는다. WCAG 2.5.3(Label in Name)도 지킨다 — 접근 이름이 보이는 글자를
 * 포함한다(`Windows` ⊃ `Win`).
 */
const SHORT: Record<Platform, string> = { mac: "mac", windows: "Win" };

const BADGE = "rounded-thumb bg-white/14 px-2 py-1 font-semibold text-on-brand";

/**
 * 사이드바의 전역 단축키 안내.
 *
 * **여기 있는 이유** — Ttabong(데스크톱 앱)의 웹뷰가 이 화면을 그대로 띄우는데 앱 쪽에는 단축키를
 * 알려 줄 자리가 없다(로그인 화면에만 있다). 그래서 사이드바에 상시 노출한다.
 *
 * **왜 한 플랫폼씩 보여 주는가** — 240px 사이드바에 macOS·Windows를 나란한 열로 두면 `Ctrl+Shift+1`
 * 길이에서 `새 태스크`가 `새 / 태스크`로 쪼개진다(앱 부서 보고, 2026-09-25). 세로로 쌓으면 구획이
 * 두 배로 길어진다. 그래서 **고르게 했다**: 머리줄 옆의 두 버튼이 플랫폼을 바꾸고, 줄 수는 예전
 * 그대로 둘이다.
 *
 * **머리줄은 한 줄이다**(2026-09-26). 제목과 버튼을 `justify-between`으로 양끝에 붙이고 줄바꿈을
 * 허용하지 않는다 — 아래 `SHORT`의 주석이 왜 전체 이름으로는 한 줄에 안 들어가는지 적어 두었다.
 * 제목은 `text-label`이라 옵션(`text-caption`)보다 크고 진해서, 무엇이 제목이고 무엇이 고르는
 * 것인지가 크기로 갈린다. 같은 `text-label`을 바로 위 `태그` 구획의 머리줄도 쓴다 — 나란히 선 두
 * 구획의 제목이 서로 다른 크기면 위계가 어긋나 보인다.
 *
 * 기본값은 서버가 요청 헤더에서 읽어 넘겨준다(`shell.tsx`) — 윈도우에서 띄운 앱은 Windows가,
 * 맥에서 띄운 앱은 macOS가 처음부터 보인다. 고른 값을 저장하지 않는 것은 의도다: 화면을 옮기면
 * 다시 자기 플랫폼으로 돌아오는 편이 맞고, 토글은 "남의 OS를 한번 보는" 자리다.
 *
 * 저장소의 세 번째 `"use client"`다(`docs/03-Architecture.md` §설계 결정 21).
 */
export function Shortcuts({ initial }: { initial: Platform }) {
  const [platform, setPlatform] = useState<Platform>(initial);

  return (
    <section
      aria-label="전역 단축키"
      className="flex flex-col gap-2 border-t border-white/14 px-3 pt-4 text-caption text-on-brand-secondary"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-on-brand">전역 단축키</p>

        {/* 선택 상태는 색만으로 말하지 않는다 — `aria-pressed`가 같은 사실을 보조기기에 전한다. */}
        <div role="group" aria-label="플랫폼" className="flex shrink-0 gap-1">
          {(Object.keys(NAME) as Platform[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPlatform(name)}
              aria-pressed={platform === name}
              aria-label={NAME[name]}
              className={
                platform === name
                  ? BADGE
                  : "rounded-thumb px-2 py-1 text-on-brand-secondary hover:bg-white/8 hover:text-on-brand"
              }
            >
              {SHORT[name]}
            </button>
          ))}
        </div>
      </div>

      {/* 열 너비는 `auto`다 — `1fr`을 쓰면 남는 폭만큼 배지가 늘어나 불필요하게 길어 보인다. */}
      <div className="grid grid-cols-[auto_auto] items-center justify-start gap-x-2 gap-y-2">
        {KEYS[platform].map(({ label, keys }) => (
          <Fragment key={label}>
            <span>{label}</span>
            <span className={BADGE}>{keys}</span>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
