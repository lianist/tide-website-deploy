import { expect, test } from "@playwright/test";

test("로그인 화면이 렌더된다", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// 보이는 이름은 Tide, 코드명은 dochi(결정 기록 10). 탭 제목이 코드명으로 되돌아가면 잡는다.
test("탭 제목이 Tide다", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle("로그인 · Tide");
});

// 빌드는 통과하면서 스타일만 조용히 죽는 경우(@tailwindcss/postcss 배선 오류,
// globals.css의 @import 누락)를 잡는다. text-h1 = 24px.
test("Tailwind 유틸리티가 실제로 적용된다", async ({ page }) => {
  await page.goto("/login");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCSS("font-size", "24px");
});

/**
 * `/`는 랜딩 페이지이면서 Supabase가 인증 흐름을 떨어뜨리는 자리다. 교통정리는 `next.config.ts`의
 * `redirects()`가 한다 — 페이지가 `searchParams`를 읽지 않아야 `/`가 정적으로 남는다(결정 기록 11).
 * 2026-09-25 핫픽스 — 가입 직후 빈 "Dochi" 화면에 착지하던 보고.
 */
test.describe("/ 랜딩과 교통정리", () => {
  test("아무것도 없으면 랜딩 페이지를 보여 준다 — 리다이렉트하지 않는다", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("귀찮은 할 일 관리, 이제 캡쳐 한번으로");
    await expect(page).toHaveTitle("Tide — 캡처를 바로 할 일로");
  });

  test("다운로드 버튼이 공증된 macOS 설치 파일을 준다", async ({ page, request }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "macOS용 다운로드" }).first();
    await expect(link).toHaveAttribute("href", "/downloads/Tide-macOS.dmg");
    const response = await request.head("/downloads/Tide-macOS.dmg");
    expect(response.status()).toBe(200);
  });

  test("Windows는 Microsoft Store로 보낸다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Microsoft Store에서 받기" }).first()).toHaveAttribute(
      "href",
      /^https:\/\/apps\.microsoft\.com\/detail\/9mtbmnxb4v62/,
    );
  });

  test("사용법 녹화 셋이 실제로 받아진다", async ({ page, request }) => {
    await page.goto("/");
    const sources = await page.locator("#how video").evaluateAll((els) => els.map((el) => el.getAttribute("src")));
    expect(sources).toHaveLength(3);
    for (const src of sources) {
      expect((await request.head(src!)).status()).toBe(200);
    }
  });

  // 옛 Framer 페이지의 방침 주소로 오는 링크(스토어 등록 정보 등)가 방침 하나에 닿는다.
  test("/policy는 /privacy로 간다", async ({ request }) => {
    const response = await request.get("/policy", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe("/privacy");
  });

  test("단축키 표기가 앱과 같은 철자다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "macOS" }).click();
    await expect(page.getByText("Shift+⌘+1")).toBeAttached();
    await page.getByRole("button", { name: "Windows" }).click();
    await expect(page.getByText("Ctrl+Shift+1")).toBeAttached();
  });

  test("바닥글이 하나뿐인 개인정보처리방침으로 간다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  // Next의 redirects()는 원래 쿼리를 목적지에 덧붙인다 — `error_code` 등이 따라가지만 `/login`은
  // `error`만 읽는다. 목적지의 `error=oauth_failed`가 이긴다.
  test("Supabase가 실패를 실어 보내면 로그인 화면에 Google 실패 안내가 뜬다", async ({ page }) => {
    await page.goto("/?error=invalid_request&error_code=bad_oauth_state&error_description=x");
    await expect(page).toHaveURL(/\/login\?error=oauth_failed(&|$)/);
    await expect(page.getByText("Google 로그인에 실패했습니다")).toBeVisible();
  });

  test("Site URL로 대체돼 온 code는 콜백으로 넘긴다", async ({ request }) => {
    const response = await request.get("/?code=abc", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"]!, "http://localhost").pathname).toBe("/auth/callback");
    expect(new URL(response.headers()["location"]!, "http://localhost").searchParams.get("code")).toBe("abc");
  });
});
