import { expect, test, type Page } from "@playwright/test";

import { bearer, dataOf, expectFailure } from "./support/api";
import {
  createAdminClient,
  createSignedInUser,
  deleteUser,
  type DochiClient,
  type TestUser,
} from "./support/supabase";
import { acceptConsentThroughUi, signInThroughUi } from "./support/ui";

/**
 * HF-06 — 개인정보처리방침 동의 게이트. 동의 전 계정은 대시보드도 API도 쓰지 못한다.
 *
 * 순서가 중요하다: 앞의 테스트들이 미동의 상태를 보고, 마지막 UI 테스트가 동의한 뒤를 본다.
 * 계정 하나를 이어 쓰는 이유는 Auth 로그인 한도(스위트를 연달아 돌리면 걸린다)를 아끼기 위해서다.
 */
test.describe.serial("개인정보처리방침 동의", () => {
  let admin: DochiClient;
  let carol: TestUser;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    admin = createAdminClient();
    carol = await createSignedInUser(admin, { consented: false });
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
    await deleteUser(admin, carol.user.id);
  });

  async function consentedAt(): Promise<string | null> {
    const { data } = await admin
      .from("profiles")
      .select("consented_at")
      .eq("id", carol.user.id)
      .single();
    return data!.consented_at;
  }

  test("공개 페이지 — 방침 전문은 로그인 없이 열린다", async ({ page: guest }) => {
    await guest.goto("/privacy");
    await expect(guest).toHaveURL(/\/privacy$/);
    await expect(guest.getByRole("heading", { name: "개인정보처리방침", level: 1 })).toBeVisible();
    await expect(guest.getByRole("heading", { name: /국외 이전/ })).toBeVisible();
  });

  test("API — 동의 전에는 403 CONSENT_REQUIRED, /me와 web-session만 열린다", async ({ request }) => {
    const headers = bearer(carol.accessToken);

    for (const path of ["/api/v1/tasks", "/api/v1/tags", "/api/v1/job-logs"]) {
      await expectFailure(await request.get(path, { headers }), "CONSENT_REQUIRED", 403);
    }
    // 캡처도 막힌다. 본문 검증보다 먼저라 LLM을 부르지 않는다.
    await expectFailure(
      await request.post("/api/v1/captures", { headers, multipart: { mode: "create" } }),
      "CONSENT_REQUIRED",
      403,
    );

    // 동의를 받으러 가는 길 — 앱은 누구로 붙어 있는지 알고, 웹뷰를 열 수 있어야 한다.
    const me = await dataOf<{ id: string }>(await request.get("/api/v1/me", { headers }));
    expect(me.id).toBe(carol.user.id);
    const session = await dataOf<{ url: string }>(
      await request.post("/api/v1/web-session", { headers }),
    );
    expect(session.url).toContain("/auth/callback?");
  });

  test("웹 — 로그인하면 동의 화면이고, 어느 화면으로 가도 돌아온다", async () => {
    await signInThroughUi(page, carol.email, carol.password);
    await expect(page).toHaveURL(/\/consent$/);
    await expect(page.getByRole("heading", { name: "시작하기 전에", level: 1 })).toBeVisible();

    for (const path of ["/dashboard", "/history", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/consent$/);
    }
  });

  test("체크가 하나라도 빠지면 서버가 거절한다", async () => {
    await page.goto("/consent");
    // 브라우저의 `required`를 걷어 내고 보낸다 — 판정은 서버가 해야 한다.
    await page.evaluate(() =>
      document.querySelectorAll("input[type=checkbox]").forEach((box) => box.removeAttribute("required")),
    );
    await page.getByLabel("개인정보처리방침에 동의합니다").check();
    await page.getByRole("button", { name: "동의하고 시작하기" }).click();

    await expect(page).toHaveURL(/\/consent\?error=consent_required$/);
    await expect(
      page.getByText("개인정보처리방침 동의와 만 14세 이상 확인이 모두 필요합니다."),
    ).toBeVisible();
    expect(await consentedAt()).toBeNull();
  });

  test("동의하지 않으면 로그아웃되고, 다시 로그인해도 동의 화면이다", async () => {
    await page.goto("/consent");
    await page.getByRole("button", { name: "동의하지 않음" }).click();
    // 직접 로그아웃과 같은 도착지 — 앱 웹뷰라면 앱도 토큰을 버린다(HF-05).
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);
    expect(await consentedAt()).toBeNull();

    await signInThroughUi(page, carol.email, carol.password);
    await expect(page).toHaveURL(/\/consent$/);
  });

  test("둘 다 체크하면 대시보드로 가고, 동의 시각이 남고, API가 열린다", async ({ request }) => {
    await acceptConsentThroughUi(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await consentedAt()).not.toBeNull();

    // 이미 동의한 계정은 동의 화면에 머물지 않는다.
    await page.goto("/consent");
    await expect(page).toHaveURL(/\/dashboard$/);

    await dataOf(await request.get("/api/v1/tasks", { headers: bearer(carol.accessToken) }));
  });
});
