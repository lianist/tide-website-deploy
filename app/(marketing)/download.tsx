"use client";

import type React from "react";

import { buttonClass } from "@/components/ui";

import { DOWNLOADS } from "./messages";
import { useDetectedPlatform } from "./shortcut-steps";

/**
 * 플랫폼 로고. 🔑 **단색(`currentColor`)으로만 그린다** — 키트는 회색·인디고·(마감/오류의) 빨강 말고
 * 다른 색을 허용하지 않아서, Microsoft 로고의 네 색도 버튼 글자색 하나로 칠한다. 채운 버튼에서는 흰색,
 * `secondary`에서는 잉크색이 된다. 이름은 버튼 글자가 말하므로 `aria-hidden`이다.
 */
const LOGO: Record<"mac" | "windows", React.ReactNode> = {
  mac: (
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  ),
  windows: <path d="M1 1h10.5v10.5H1zM12.5 1H23v10.5H12.5zM1 12.5h10.5V23H1zM12.5 12.5H23V23H12.5z" />,
};

function PlatformLogo({ name }: { name: "mac" | "windows" }) {
  return (
    // `mr-1` — 버튼의 `gap-1`(4)에 더해 로고와 글자 사이를 8로 벌린다. `gap-2`를 덧붙이지 않는 것은
    // 같은 프로퍼티를 두 번 적으면 어느 쪽이 이길지 호출부가 모르기 때문이다(`components/ui.tsx` 주석).
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="mr-1 shrink-0">
      {LOGO[name]}
    </svg>
  );
}

/**
 * 주 행동 — 설치 파일 받기. 🔑 **채운 버튼은 하나다**(키트 3-2): 방문자의 플랫폼 것이 `primary`,
 * 다른 하나는 `secondary`다. 서버 렌더에서는 플랫폼을 모르므로 macOS가 앞선다 — Windows 방문자에게는
 * 하이드레이션 직후 한 번 순서와 채움이 바뀐다. 두 버튼의 크기가 같아 줄이 밀리지 않는다.
 */
export function Download({ id }: { id?: string }) {
  const platform = useDetectedPlatform() ?? "mac";
  const order = platform === "windows" ? (["windows", "mac"] as const) : (["mac", "windows"] as const);
  return (
    <div id={id} className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-3">
        {order.map((name, i) => {
          const item = DOWNLOADS[name];
          return (
            <a
              key={name}
              href={item.href}
              {...(name === "mac" ? { download: "" } : { target: "_blank", rel: "noopener" })}
              className={buttonClass(i === 0 ? "primary" : "secondary", "lg")}
            >
              <PlatformLogo name={name} />
              {item.label}
            </a>
          );
        })}
      </div>
      <p className="num text-center text-caption text-ink-secondary">
        {DOWNLOADS[order[0]].note}
        <br />
        {DOWNLOADS[order[1]].note}
      </p>
    </div>
  );
}
