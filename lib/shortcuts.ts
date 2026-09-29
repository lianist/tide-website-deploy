export type Platform = "mac" | "windows";

/**
 * 전역 단축키의 **표기** — 사이드바(`app/(app)/shortcuts.tsx`)와 랜딩(`app/(marketing)/`)이 같이 쓴다.
 *
 * 🔴 **철자는 앱의 `HotkeyConfig.shortcutDisplay`와 한 글자도 다르지 않아야 한다**(앱 부서 요청,
 * 2026-09-25). 앱 창 안에서는 같은 단축키가 웹의 표기와 앱의 표기로 나란히 보이기 때문에, 한쪽이
 * `Ctrl+⇧1`이고 한쪽이 `Ctrl+Shift+1`이면 사용자에게는 서로 다른 조합처럼 읽힌다.
 * **이 문구를 고치려면 앱 부서에 먼저 알린다** — 그쪽이 문구를 찾아 바꾸는 코드를 들고 있다.
 *
 * 실제 등록은 앱이 하는 고정값이고 웹은 그 값을 문구로만 따라간다. Windows에서 `meta`는 Windows
 * 키이고 `Win+Shift+숫자`는 셸이 이미 쓰고 있어서 `Ctrl`을 대신 쓴다.
 */
export const KEYS: Record<Platform, readonly { readonly label: string; readonly keys: string }[]> = {
  mac: [
    { label: "새 태스크", keys: "Shift+⌘+1" },
    { label: "완료", keys: "Shift+⌘+2" },
  ],
  windows: [
    { label: "새 태스크", keys: "Ctrl+Shift+1" },
    { label: "완료", keys: "Ctrl+Shift+2" },
  ],
};

export const PLATFORM_NAME: Record<Platform, string> = { mac: "macOS", windows: "Windows" };
