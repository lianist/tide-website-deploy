import { expect, type Page } from "@playwright/test";

/**
 * 브라우저에 쿠키 세션을 세운다 — 비밀번호 로그인 화면을 그대로 지난다.
 *
 * 토큰을 직접 심지 않는 이유: 화면 테스트가 보려는 것에는 "로그인한 브라우저가 이 페이지를
 * 받는다"까지 들어 있다. 쿠키를 손으로 만들면 `proxy.ts`와 `requireUser()`를 건너뛴다.
 */
export async function signInThroughUi(
  page: Page,
  email: string,
  password: string,
  path = "/login",
): Promise<void> {
  await page.goto(path);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/**
 * 개인정보처리방침 동의 화면(`/consent`)을 실제로 지나 대시보드에 닿는다(HF-06). 화면으로 가입한
 * 계정은 미동의로 시작하므로, 가입 흐름을 도는 테스트가 이것을 부른다.
 */
export async function acceptConsentThroughUi(page: Page): Promise<void> {
  await page.getByLabel("개인정보처리방침에 동의합니다").check();
  await page.getByLabel("만 14세 이상입니다").check();
  await page.getByRole("button", { name: "동의하고 시작하기" }).click();
}

/**
 * 사이드바의 태그 구획을 펼친다(HF-12). 태그를 고르지 않은 대시보드에서는 접혀 있고, 닫힌
 * `<details>` 안의 "태그 필터" 네비는 접근성 트리에서 빠진다. 이미 열려 있으면 누르지 않는다 —
 * 머리줄은 토글이라 한 번 더 누르면 도로 접힌다.
 */
export async function openTagFilter(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "태그 필터" });
  if (await nav.isVisible()) return;
  await page.locator("summary", { hasText: "태그" }).click();
  await expect(nav).toBeVisible();
}

declare global {
  interface Window {
    dochiProbe?: number;
  }
}

/**
 * "전체 재로드가 아니었다"를 증명하는 표식.
 *
 * `page.reload()`를 부르지 않는 것만으로는 부족하다 — 코드가 스스로 재로드할 수도 있다. 표식을
 * 하나 심어 두고 화면이 바뀐 뒤에도 값이 그대로면, 그 사이에 문서가 새로 로드되지 않았다는 뜻이다.
 */
export async function plantProbe(page: Page): Promise<number> {
  return page.evaluate(() => {
    window.dochiProbe = Date.now();
    return window.dochiProbe;
  });
}

export async function readProbe(page: Page): Promise<number | null> {
  return page.evaluate(() => window.dochiProbe ?? null);
}
