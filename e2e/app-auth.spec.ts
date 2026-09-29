import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { bearer, dataOf, expectFailure } from "./support/api";
import {
  createAdminClient,
  deleteUser,
  markConsented,
  newTestEmail,
  type DochiClient,
} from "./support/supabase";
import { signInThroughUi } from "./support/ui";

/**
 * L-P0-04 검증 — 앱 로그인 딥링크 브리지(`AUTH-3` 웹 측). 계약은 `docs/04-API-Contract.md` §앱 로그인.
 *
 * 커스텀 스킴(`dochi://`)을 받을 핸들러가 테스트 브라우저에 없으므로 **따라가지 않는다.** 대신
 * 안내 화면의 meta refresh 주소를 읽거나(`deepLinkFrom`), 브라우저가 그 주소로 가려는 요청을 가로채 본다.
 * 앱이 할 일(코드 교환·갱신)은 앱과 같은 요청을 직접 보내 재현한다.
 */
test.describe.configure({ mode: "serial" });

const APP_REDIRECT = "dochi://auth/callback";
const PASSWORD = "dochi-test-1234";
const START = `/auth/app/start?redirect_uri=${encodeURIComponent(APP_REDIRECT)}&state=s-123`;
const TOKEN = "/auth/app/token";

interface AppSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: { id: string; email: string | null };
}

/**
 * 로그인된 브라우저(쿠키)로 진입점을 밟고 딥링크를 읽는다 — 앱이 브라우저를 여는 경우와 같다.
 *
 * 진입점은 `307`이 아니라 **안내 화면(`200`) + `<meta http-equiv="refresh">`** 로 딥링크를 건넨다
 * (`8b02402`, 2026-09-28 — `dochi://`로 가는 HTTP 리다이렉트는 탭을 멈춘 것처럼 보이게 했다).
 * 그래서 Location 대신 refresh의 주소를 읽는다. HTML 속성이라 `&`가 `&amp;`로 온다.
 */
async function deepLinkFrom(request: APIRequestContext): Promise<URL> {
  const response = await request.get(START, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const refresh = /<meta http-equiv="refresh" content="0;url=([^"]+)"/i.exec(await response.text());
  expect(refresh, "안내 화면의 meta refresh").not.toBeNull();
  return new URL(refresh![1]!.replaceAll("&amp;", "&"));
}

async function exchange(request: APIRequestContext, body: unknown) {
  return request.post(TOKEN, { data: body });
}

test.describe("앱 로그인 딥링크 브리지", () => {
  let admin: DochiClient;
  let userId: string;
  let email: string;

  test.beforeAll(async () => {
    admin = createAdminClient();
    email = newTestEmail();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`테스트 계정 생성 실패: ${error?.message}`);
    userId = data.user.id;
    await markConsented(admin, userId);
  });

  test.afterAll(async () => {
    await deleteUser(admin, userId);
  });

  test("허용 목록과 정확히 같지 않은 redirect_uri는 어디로도 보내지 않는다", async ({ request }) => {
    const rejected = [
      "/auth/app/start",
      `/auth/app/start?redirect_uri=${encodeURIComponent("https://evil.test/callback")}`,
      `/auth/app/start?redirect_uri=${encodeURIComponent("dochi://evil")}`,
      // 접두어 비교였다면 통과했을 주소들
      `/auth/app/start?redirect_uri=${encodeURIComponent("dochi://auth/callback.evil")}`,
      `/auth/app/start?redirect_uri=${encodeURIComponent("dochi://auth/callback/../x")}`,
      `/auth/app/start?redirect_uri=${encodeURIComponent("dochi://auth/callback?x=1")}`,
    ];
    for (const path of rejected) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.headers()["location"], path).toBeUndefined();
      expect(await response.text(), path).toContain("허용되지 않은 앱 주소입니다.");
    }
  });

  test("로그인 전이면 원래 요청을 next에 실어 로그인 화면으로 보낸다", async ({ request }) => {
    const response = await request.get(START, { maxRedirects: 0 });
    expect(response.status()).toBe(307);

    const location = new URL(response.headers()["location"]!, "http://localhost");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(START);
  });

  test("로그인 화면을 지나면 딥링크로 일회용 코드와 state가 돌아온다", async ({ page }) => {
    await page.goto(START);
    await expect(page).toHaveURL(/\/login\?next=/);

    // 로그인 화면의 모든 갈래가 next를 잃지 않는다.
    const next = encodeURIComponent(START);
    await expect(page.getByRole("link", { name: "Google로 계속하기" })).toHaveAttribute(
      "href",
      `/auth/google?next=${next}`,
    );
    await expect(page.getByRole("link", { name: /가입하기/ })).toHaveAttribute("href", `/signup?next=${next}`);

    // 핸들러가 없어 이동 자체는 실패하지만, 브라우저가 그 주소로 가려 한 요청은 잡힌다.
    const handoff = page.waitForRequest((request) => request.url().startsWith("dochi://"));
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    const deepLink = new URL((await handoff).url());
    expect(`${deepLink.protocol}//${deepLink.host}${deepLink.pathname}`).toBe(APP_REDIRECT);
    expect(deepLink.searchParams.get("state")).toBe("s-123");
    expect(deepLink.searchParams.get("code")).toBeTruthy();
    // 오래 사는 토큰은 URL에 실리지 않는다 — 코드만.
    expect([...deepLink.searchParams.keys()].sort()).toEqual(["code", "state"]);

    // 브라우저가 받은 그 코드가 바로 쓸 수 있는 코드다 — 도중에 다른 코드가 또 발급돼 덮어쓰지 않았다.
    const code = deepLink.searchParams.get("code")!;
    const session = await dataOf<AppSession>(await exchange(page.request, { grantType: "code", code }));
    expect(session.user.id).toBe(userId);
  });

  test("틀린 비밀번호로 실패해도 next가 남는다", async ({ page }) => {
    await page.goto(START);
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL(/error=invalid_credentials/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(START);
  });

  test("코드를 교환하면 앱 전용 세션이 서고, 코드는 한 번만 쓸 수 있다", async ({ page, request }) => {
    await signInThroughUi(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    const code = (await deepLinkFrom(page.request)).searchParams.get("code")!;

    const session = await dataOf<AppSession>(await exchange(request, { grantType: "code", code }));
    expect(session.user).toEqual({ id: userId, email });
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    expect(session.refreshToken.length).toBeGreaterThan(0);

    // 받은 토큰이 앱이 쓰는 그 경로(`/api/v1`, Bearer)에서 통한다.
    const me = await dataOf<{ id: string }>(
      await request.get("/api/v1/me", { headers: bearer(session.accessToken) }),
    );
    expect(me.id).toBe(userId);

    // 재사용·쓰레기 코드는 같은 401이다.
    await expectFailure(await exchange(request, { grantType: "code", code }), "UNAUTHORIZED", 401);
    await expectFailure(
      await exchange(request, { grantType: "code", code: "not-a-real-code" }),
      "UNAUTHORIZED",
      401,
    );
  });

  test("본문이 틀리면 400이다", async ({ request }) => {
    for (const body of [{}, { grantType: "password" }, { grantType: "code" }, { grantType: "refreshToken", refreshToken: " " }]) {
      await expectFailure(await exchange(request, body), "VALIDATION_FAILED", 400);
    }
    await expectFailure(
      await request.post(TOKEN, { data: "not json", headers: { "Content-Type": "application/json" } }),
      "VALIDATION_FAILED",
      400,
    );
  });

  test("앱은 여기서 세션을 갱신하고, 웹 로그아웃이 앱 세션을 끊지 않는다", async ({ page, request }) => {
    await signInThroughUi(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    const code = (await deepLinkFrom(page.request)).searchParams.get("code")!;
    const first = await dataOf<AppSession>(await exchange(request, { grantType: "code", code }));

    // 웹에서 로그아웃한다. 앱은 브라우저와 다른 세션이라 영향을 받지 않아야 한다.
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);

    // 서버가 토큰마다 세션까지 Auth에 확인하므로(HF-05) 이 단언이 의미를 갖는다 — 웹의 local
    // 로그아웃이 앱 세션을 폐기했다면 여기서 401이 난다.
    await dataOf(await request.get("/api/v1/me", { headers: bearer(first.accessToken) }));

    const refreshed = await dataOf<AppSession>(
      await exchange(request, { grantType: "refreshToken", refreshToken: first.refreshToken }),
    );
    expect(refreshed.user.id).toBe(userId);
    expect(refreshed.refreshToken).not.toBe(first.refreshToken);

    const me = await dataOf<{ id: string }>(
      await request.get("/api/v1/me", { headers: bearer(refreshed.accessToken) }),
    );
    expect(me.id).toBe(userId);

    await expectFailure(
      await exchange(request, { grantType: "refreshToken", refreshToken: "not-a-real-token" }),
      "UNAUTHORIZED",
      401,
    );
  });

  /**
   * 2026-09-25 핫픽스 — 앱 세션을 웹뷰로 이어 준다(`POST /api/v1/web-session`). 앱이 할 순서 그대로다:
   * 딥링크 코드를 교환한 **직후** 발급을 부른다(새 발급이 이전 코드를 무효화하므로 교환이 먼저다).
   */
  test.describe("웹뷰 세션 이어주기", () => {
    const WEB_SESSION = "/api/v1/web-session";

    /** 브라우저 로그인 → 딥링크 코드 → 앱 세션. 앱이 로그인을 막 끝낸 상태다. */
    async function appSession(page: Page, request: APIRequestContext) {
      await signInThroughUi(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/dashboard$/);
      const code = (await deepLinkFrom(page.request)).searchParams.get("code")!;
      return dataOf<AppSession>(await exchange(request, { grantType: "code", code }));
    }

    test("Bearer 없이는 401이다", async ({ request }) => {
      await expectFailure(await request.post(WEB_SESSION), "UNAUTHORIZED", 401);
    });

    test("받은 주소를 쿠키 없는 브라우저가 열면 로그인된 채 대시보드에 도착하고, 주소는 한 번만 통한다", async ({
      page,
      request,
      browser,
    }) => {
      const session = await appSession(page, request);
      const { url } = await dataOf<{ url: string }>(
        await request.post(WEB_SESSION, { headers: bearer(session.accessToken) }),
      );
      const link = new URL(url);
      expect(link.pathname).toBe("/auth/callback");
      expect(link.searchParams.get("type")).toBe("magiclink");
      expect(link.searchParams.get("next")).toBe("/dashboard");

      // 웹뷰 = 쿠키가 하나도 없는 새 컨텍스트
      const webview = await browser.newContext();
      const tab = await webview.newPage();
      await tab.goto(url);
      await expect(tab).toHaveURL(/\/dashboard$/);
      await expect(tab.getByRole("button", { name: "로그아웃" })).toBeVisible();
      await webview.close();

      const again = await browser.newContext();
      const second = await again.newPage();
      await second.goto(url);
      await expect(second).toHaveURL(/\/login\?error=link_expired/);
      await again.close();
    });

    test("next를 운반하되 사이트 밖으로는 보내지 않는다", async ({ page, request }) => {
      const session = await appSession(page, request);
      const nextOf = async (data: unknown) => {
        const { url } = await dataOf<{ url: string }>(
          await request.post(WEB_SESSION, { headers: bearer(session.accessToken), data }),
        );
        return new URL(url).searchParams.get("next");
      };
      expect(await nextOf({ next: "/history?log=abc" })).toBe("/history?log=abc");
      expect(await nextOf({ next: "//evil.test" })).toBe("/dashboard");
      expect(await nextOf({ next: "https://evil.test" })).toBe("/dashboard");
    });
  });
});
