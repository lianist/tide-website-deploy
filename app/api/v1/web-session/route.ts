import { withAuth } from "@/lib/api/auth";
import { fail, ok } from "@/lib/api/envelope";
import { readJsonObject } from "@/lib/api/input";
import { issueCode } from "@/lib/auth/app-bridge";
import { safeNext } from "@/lib/auth/next";

/**
 * `POST /api/v1/web-session` — 앱의 세션을 **앱 안 웹뷰**로 이어 줄 일회용 로그인 주소를 낸다.
 *
 * 앱은 세션이 두 벌이다 — 딥링크로 받은 앱 세션(Bearer)과 대시보드 웹뷰의 쿠키 세션. 이어 주지 않으면
 * 웹뷰가 웹 로그인을 한 번 더 요구하고, macOS에선 그 웹뷰의 Google 로그인이 성립하지 않는다(Google이
 * WKWebView를 막아 앱이 시스템 브라우저로 넘기면, PKCE 검증 쿠키는 웹뷰에 남고 콜백은 브라우저에 도착한다).
 * 이유와 대가는 `docs/03-Architecture.md` §설계 결정 18.
 *
 * 새 인증 경로를 만들지 않는다 — 딥링크와 같은 코드(`issueCode`)를 메일 링크와 같은 콜백 분기
 * (`/auth/callback`의 `token_hash`)에 실을 뿐이다. 주소에 코드가 실리므로 **로그에 남기지 않는다.**
 *
 * **개인정보처리방침 동의 전에도 연다**(HF-06). 앱이 `403 CONSENT_REQUIRED`를 받고 동의 화면에 닿는
 * 길이 이 주소다 — 웹뷰가 열면 대시보드가 `/consent`로 보낸다. 막으면 앱에서는 동의할 방법이 없다.
 */
export const POST = withAuth(async (request, { email }) => {
  // 본문은 선택이다. 없거나 JSON이 아니면 기본 목적지(`/dashboard`)로 간다.
  const body = await readJsonObject(request);
  const next = safeNext(typeof body?.next === "string" ? body.next : null);

  const code = email ? await issueCode(email) : null;
  if (!code) return fail("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");

  const url = new URL("/auth/callback", request.url);
  url.searchParams.set("token_hash", code);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", next);
  return ok({ url: url.toString() });
}, { requireConsent: false });
