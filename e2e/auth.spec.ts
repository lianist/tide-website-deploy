import { expect, test } from "@playwright/test";

import {
  createAdminClient,
  deleteUserByEmail,
  generateEmailToken,
  newTestEmail,
  type DochiClient,
} from "./support/supabase";
import { acceptConsentThroughUi } from "./support/ui";

/**
 * L-P0-03 검증 — 사람이 브라우저로 가입·로그인·비밀번호 재설정을 할 수 있는지 본다.
 *
 * **메일을 실제로 보내지 않는다.** 확인 링크와 재설정 링크는 관리자 API(`generateLink`)로 토큰만
 * 만들어 `/auth/callback`에 직접 실어 준다. 발송까지 타면 SMTP 설정과 시간당 발송 제한에 묶여
 * 테스트가 환경에 의존하게 되고, 정작 확인하려는 것(세션이 서는가)은 그대로다.
 * 실제 발송과 Google 동의 화면 통과는 ROADMAP의 수동 체크로 남겨 두었다.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "dochi-test-1234";

test.describe("웹 인증", () => {
  let admin: DochiClient;

  test.beforeAll(() => {
    admin = createAdminClient();
  });

  test("가입하면 바로 대시보드에 닿고, 기본 데이터가 만들어진다", async ({ page }) => {
    const email = newTestEmail();

    await page.goto("/signup");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "가입하기" }).click();

    // 메일 확인을 껐으므로(2026-09-25, 설계 결정 12) 가입이 곧 로그인이다 — 안내 화면을 거치지 않는다.
    // 새 계정은 방침 동의 화면을 먼저 지난다(HF-06).
    await expect(page).toHaveURL(/\/consent$/);
    await acceptConsentThroughUi(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "오늘 할 일", level: 1 })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // AGT-5의 전제 — 가입 트리거가 프로필과 '미분류' 태그를 만들어 두어야 한다.
    // 화면이 아니라 DB를 본다. RLS를 우회하는 관리자 클라이언트로 직접 센다.
    const { data: users } = await admin.auth.admin.listUsers();
    const userId = users.users.find((user) => user.email === email)!.id;

    const { count: profiles } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("id", userId);
    expect(profiles).toBe(1);

    const { data: tags } = await admin.from("tags").select("name").eq("user_id", userId);
    expect(tags).toEqual([{ name: "미분류" }]);

    await deleteUserByEmail(admin, email);
  });

  // 2026-09-25 QA — 이미 가입된 주소로 다시 가입하면 메일 확인을 켜 둔 동안은 Supabase가 가짜 성공만 주고
  // 메일을 보내지 않아 사용자가 "메일이 안 온다"에서 멈췄다. 확인을 끈 지금은 이유를 말해 준다.
  test("이미 가입된 주소로 다시 가입하면 이유를 알려 준다", async ({ page }) => {
    const email = newTestEmail();
    const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    expect(error).toBeNull();

    await page.goto("/signup");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "가입하기" }).click();

    await expect(page).toHaveURL(/\/signup\?error=user_already_exists$/);
    await expect(page.getByText("이미 가입된 이메일입니다. 로그인해 주세요.")).toBeVisible();

    await deleteUserByEmail(admin, email);
  });

  test("로그인·로그아웃과 보호 경로가 동작한다", async ({ page }) => {
    const email = newTestEmail();
    const tokenHash = await generateEmailToken(admin, "signup", email, PASSWORD);
    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=signup&next=/dashboard`);
    await expect(page).toHaveURL(/\/consent$/);
    await acceptConsentThroughUi(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    // 직접 누른 로그아웃은 `signedOut=1`을 달고 도착한다 — 앱이 이 표시로 자기 토큰도 버린다(HF-05).
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);

    // 로그인하지 않은 채로는 대시보드에 닿지 못한다. 이 리다이렉트는 proxy가 아니라
    // 페이지의 requireUser()가 만든다 — 판단하는 자리가 하나라는 것의 확인이다.
    // 여기에는 `signedOut`이 붙지 않아야 한다. 앱은 이 둘의 차이로 "만료"와 "로그아웃"을 가른다.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    // 틀린 비밀번호는 이메일이 틀렸는지 비밀번호가 틀렸는지 알려 주지 않는다.
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/error=invalid_credentials/);
    await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();

    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await deleteUserByEmail(admin, email);
  });

  /**
   * HF-02 — 앱 웹뷰에는 비밀번호를 확인할 길이 전혀 없었다. Edge가 그려 주는 기본 눈 버튼은
   * 브라우저 셸의 UI라 WebView2에서는 눌리지 않고, WKWebView에는 아예 없다(앱 부서 보고).
   *
   * ⚠️ **이 테스트는 우리 토글만 본다.** 기본 눈 버튼이 숨겨졌는지는 Chromium에서 확인할 수
   * 없고(`::-ms-reveal`은 Edge 전용), 웹뷰에서 눌리지 않는다는 사실도 여기서는 재현되지 않는다.
   */
  test("비밀번호 보기 토글이 인증 화면에서 같게 동작한다", async ({ page }) => {
    for (const path of ["/login", "/signup"]) {
      await page.goto(path);

      const field = page.getByLabel("비밀번호", { exact: true });
      await field.fill(PASSWORD);
      await expect(field).toHaveAttribute("type", "password");

      await page.getByRole("button", { name: "비밀번호 보기" }).click();
      await expect(field).toHaveAttribute("type", "text");
      // 토글이 값을 지우지도, 폼을 제출하지도 않는다(`type="button"`).
      await expect(field).toHaveValue(PASSWORD);
      await expect(page).toHaveURL(new RegExp(`${path}$`));

      await page.getByRole("button", { name: "비밀번호 숨기기" }).click();
      await expect(field).toHaveAttribute("type", "password");
    }
  });

  test("Google 버튼이 구글 동의 화면으로 보낸다", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Google로 계속하기" })).toHaveAttribute(
      "href",
      "/auth/google",
    );

    // 실제 구글 로그인은 자동화하지 않는다. **어디로 보내려 했는지**만 본다.
    // 브라우저로 구글 페이지를 실제로 열면 그 페이지의 내부 요청까지 섞여 들어와 흔들리므로,
    // 리다이렉트를 따라가지 않고 Location 헤더를 한 홉씩 직접 읽는다.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const entry = await request.get("/auth/google", { maxRedirects: 0 });
    const authorizeUrl = entry.headers()["location"] ?? "";
    expect(authorizeUrl).toContain(`${supabaseUrl}/auth/v1/authorize`);
    expect(authorizeUrl).toContain("provider=google");
    // 돌아올 주소가 우리 콜백이어야 한다.
    expect(decodeURIComponent(authorizeUrl)).toContain("/auth/callback");

    // 여기서 구글로 넘어간다. 프로바이더가 꺼져 있거나 키가 없으면 Supabase가 구글 대신
    // 에러로 보내므로, 이 단언은 대시보드 설정이 제대로 됐을 때만 통과한다.
    const authorize = await request.get(authorizeUrl, { maxRedirects: 0 });
    const googleUrl = authorize.headers()["location"] ?? "";
    expect(googleUrl).toContain("accounts.google.com");
    expect(googleUrl).toContain("client_id=");
    expect(decodeURIComponent(googleUrl)).toContain(`${supabaseUrl}/auth/v1/callback`);

    // 앱 딥링크(L-P0-04)가 실은 next는 콜백 주소까지 그대로 운반된다.
    const next = "/auth/app/start?redirect_uri=dochi%3A%2F%2Fauth%2Fcallback&state=s";
    const withNext = await request.get(`/auth/google?next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
    });
    const redirectTo = new URL(withNext.headers()["location"]!).searchParams.get("redirect_to")!;
    expect(new URL(redirectTo).searchParams.get("next")).toBe(next);
  });

  test("비밀번호 재설정 메일을 요청하고 새 비밀번호로 다시 로그인한다", async ({ page }) => {
    // 가입되지 않은 주소에도 같은 성공 화면을 보여 준다 — 계정의 존재 여부를 흘리지 않는다.
    await page.goto("/reset-password");
    await page.getByLabel("이메일").fill(`unknown-${crypto.randomUUID()}@dochi.test`);
    await page.getByRole("button", { name: "재설정 메일 보내기" }).click();
    await expect(page.getByText("재설정 메일을 보냈습니다. 메일함을 확인해 주세요.")).toBeVisible();

    // 실제 계정으로 복귀 경로를 끝까지 돈다.
    const email = newTestEmail();
    const signupToken = await generateEmailToken(admin, "signup", email, PASSWORD);
    await page.goto(`/auth/callback?token_hash=${signupToken}&type=signup&next=/dashboard`);
    await acceptConsentThroughUi(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "로그아웃" }).click();
    // 도착을 기다린다. 안 기다리면 늦게 끝난 signOut이 아래 재설정 링크가 세운 세션을 지워
    // 저장 뒤 /login으로 떨어진다 — 배포본에서만 꾸준히 재현됐다(HF-03 · HF-05).
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);

    const recoveryToken = await generateEmailToken(admin, "recovery", email);
    await page.goto(
      `/auth/callback?token_hash=${recoveryToken}&type=recovery&next=/reset-password/update`,
    );
    await expect(page).toHaveURL(/\/reset-password\/update$/);

    const newPassword = "dochi-test-5678";
    await page.getByLabel("비밀번호", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "비밀번호 저장" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);

    // 옛 비밀번호는 더 이상 통하지 않는다.
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/error=invalid_credentials/);

    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await deleteUserByEmail(admin, email);
  });
});
