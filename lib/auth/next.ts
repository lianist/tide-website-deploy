/**
 * 인증을 마친 뒤 돌아갈 곳(`next`). 로그인·가입·Google·메일 링크가 모두 이 값을 끝까지 운반한다 —
 * 앱 딥링크(`/auth/app/start`, `L-P0-04`)가 "로그인을 마치면 다시 나에게"로 이 길을 쓰기 때문이다.
 */

export const DEFAULT_NEXT = "/dashboard";

/**
 * **열린 리다이렉트를 막는다.** `next`는 우리 사이트 안의 경로여야 한다. `//evil.com`처럼
 * 슬래시 두 개로 시작하면 브라우저가 바깥 도메인으로 읽으므로 함께 막는다.
 *
 * 앱 딥링크(`dochi://…`)는 여기로 열지 않는다. `next`는 언제나 `/auth/app/start`라는 **내부 경로**이고,
 * 스킴 허용 목록 검사는 그 핸들러 한 곳에서만 한다(`lib/auth/app-bridge.ts`).
 */
export function safeNext(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : DEFAULT_NEXT;
}

/** `path`에 `next`를 쿼리로 붙인다. 기본값이면 붙이지 않는다 — 평범한 로그인의 URL을 그대로 두려고. */
export function withNext(path: string, next: string): string {
  if (next === DEFAULT_NEXT) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}
