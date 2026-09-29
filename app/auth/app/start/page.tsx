import { redirect } from "next/navigation";

import { TideLogo } from "@/components/icons";
import { Alert, buttonClass, cardClass } from "@/components/ui";
import { isAllowedAppRedirect, issueCode } from "@/lib/auth/app-bridge";
import { withNext } from "@/lib/auth/next";
import { currentUser } from "@/lib/supabase/session";

export const metadata = { title: "앱 로그인 · Tide" };

/**
 * `/auth/app/start?redirect_uri=dochi://auth/callback&state=…` — 앱이 브라우저로 여는 진입점(`AUTH-3`).
 *
 * 1. `redirect_uri`가 허용 목록과 정확히 같지 않으면 오류 화면. **어디로도 보내지 않는다**(열린 리다이렉트 방지).
 * 2. 로그인 전이면 `/login?next=<이 주소>`로 보낸다. 로그인·Google이 `next`를 끝까지 운반해 여기로 돌아온다.
 * 3. 로그인돼 있으면 **앱 전용 새 세션**을 열 일회용 코드를 만들어 딥링크로 보낸다.
 *
 * **Route Handler가 아니라 페이지인 이유**: 로그인 Server Action이 여기로 `redirect()`하면 Next는 대상을
 * 서버 안에서 미리 fetch해 응답에 인라인하려 한다. Route Handler가 `dochi://`로 307하면 그 fetch가
 * "HTTP(S)가 아님"으로 실패하고, 라우터의 재시도와 하드 내비게이션까지 거치며 **코드가 세 번 발급됐다.**
 * 페이지의 `redirect()`는 문서 요청이면 307, Server Action 뒤면 RSC 안의 리다이렉트 지시가 되어 한 번에 끝난다.
 *
 * 브라우저 세션 토큰을 그대로 넘기지 않는 이유와 코드를 싣는 이유는 `docs/03-Architecture.md` §설계 결정 18.
 */
export default async function AppStartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUri = typeof params.redirect_uri === "string" ? params.redirect_uri : null;
  const state = typeof params.state === "string" ? params.state : null;

  if (!isAllowedAppRedirect(redirectUri)) {
    return (
      // `(auth)` 그룹 밖이라 AuthLayout을 못 받는다. 같은 조판을 여기서 한 번 더 그린다 —
      // 사용자에게는 방금 지나온 로그인 화면과 이어지는 한 화면이어야 한다.
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
        <div className="flex justify-center">
          <TideLogo height={24} />
        </div>

        <div className={`${cardClass} flex flex-col gap-4 px-6 py-8`}>
          <h1 className="font-heading text-h1 text-ink">앱으로 돌아갈 수 없습니다</h1>
          <Alert>허용되지 않은 앱 주소입니다. 앱에서 로그인을 다시 시작해 주세요.</Alert>
        </div>
      </main>
    );
  }

  const user = await currentUser();
  if (!user) {
    const self = new URLSearchParams({ redirect_uri: redirectUri });
    if (state !== null) self.set("state", state);
    redirect(withNext("/login", `/auth/app/start?${self}`));
  }

  // `state`는 앱이 자기 요청임을 확인하는 값이다. 서버는 해석하지 않고 그대로 돌려준다.
  const deepLink = new URL(redirectUri);
  if (state !== null) deepLink.searchParams.set("state", state);

  const code = user.email ? await issueCode(user.email) : null;
  deepLink.searchParams.set(code ? "code" : "error", code ?? "server_error");
  const deepLinkHref = deepLink.toString();

  /**
   * **렌더한다, `redirect()`하지 않는다.** 브라우저는 `dochi://`로 가는 HTTP 리다이렉트를
   * "이동"으로 취급하지 않는다 — OS에 핸드오프만 하고 탭 자체는 이동 직전 화면(Google 계정 선택
   * 중간 단계 등)에 그대로 멈춰 있는다(QA 2026-09-28, `HF-01`과 같은 원인). 앱은 이미 코드를
   * 받아 로그인을 끝냈는데도 탭만 영원히 로딩 중으로 보여 사용자가 뭔가 실패했다고 오해한다.
   *
   * `<meta http-equiv="refresh">`는 다르다 — 페이지가 실제로 완성되어 그려진 *뒤에* 새 내비게이션을
   * 거는 것이라 브라우저가 "이 문서는 끝났다"고 인지한다. 핸드오프가 되든 안 되든 사용자는 항상
   * 이 화면을 보고, 자동으로 안 열리면 누를 수 있는 링크도 있다.
   */
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <meta httpEquiv="refresh" content={`0;url=${deepLinkHref}`} />

      <div className="flex justify-center">
        <TideLogo height={24} />
      </div>

      <div className={`${cardClass} flex flex-col gap-4 px-6 py-8 text-center`}>
        <h1 className="font-heading text-h1 text-ink">Tide로 돌아가는 중입니다</h1>
        <p className="text-body-s text-ink-secondary">
          자동으로 열리지 않으면 아래 버튼을 눌러 주세요. 앱이 열렸다면 이 창은 닫으셔도 됩니다.
        </p>
        <a href={deepLinkHref} className={buttonClass("primary")}>
          Tide 앱 열기
        </a>
      </div>
    </main>
  );
}
