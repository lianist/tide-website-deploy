import { expect, test, type Page } from "@playwright/test";

import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";
import { signInThroughUi } from "./support/ui";

/*
  `needs-review.spec.ts`와 갈라 둔 이유 — 저쪽은 소스(`lib/api/job-logs.ts`)를 직접 불러 배포본 대상
  실행에서 빠지지만(`LOCAL_ONLY_SPECS`, 설계 결정 22), 이쪽은 화면만 지나므로 배포본에서도 돈다.
*/
test.describe.configure({ mode: "serial" });

/** 2026-09-24의 어느 시각(UTC). 시각을 갈라 심어 최신순 단언이 실행마다 흔들리지 않게 한다. */
const AT = (hour: number) => new Date(Date.UTC(2026, 8, 24, hour)).toISOString();

/**
 * L-P1-12 검증 — 확인 필요 화면(`DASH-11`). 사이드바 배지 · '오늘' 배너 · 보기 · [넘기기] · [직접 처리].
 *
 * 위 describe와 계정을 가른다 — 저쪽이 처리 표시를 이리저리 바꿔 두어 건수가 순서에 묶인다.
 * 건수는 **이동할 때 갱신된다**(사용자 결정 2026-09-25)라 매 단계 화면을 다시 연다.
 */
test.describe("확인 필요 화면", () => {
  let admin: DochiClient;
  let carol: TestUser;
  let page: Page;
  let skipId: string;
  let handleId: string;

  const menu = () => page.getByRole("navigation", { name: "주요 메뉴" });
  const reviewLink = () => menu().getByRole("link", { name: /^확인 필요/ });
  const banner = () => page.getByRole("status").filter({ hasText: "확인이 필요한 캡처가" });
  const reviewSection = () => page.getByRole("region", { name: "확인 필요" });
  const item = (id: string) => reviewSection().locator(`li[data-log-id="${id}"]`);

  test.beforeAll(async ({ browser }) => {
    admin = createAdminClient();
    carol = await createSignedInUser(admin);

    const { data, error } = await carol.client
      .from("job_logs")
      .insert([
        { user_id: carol.user.id, source: "capture_create", outcome: "failed", failure_reason: "NO_TASK_TO_CREATE", capture_summary: "넘길 캡처. 과제 공지 같다.", created_at: AT(10) },
        { user_id: carol.user.id, source: "capture_create", outcome: "failed", failure_reason: "AGENT_TIMEOUT", capture_summary: null, created_at: AT(11) },
      ])
      .select("id, failure_reason");
    expect(error).toBeNull();
    skipId = data!.find((row) => row.failure_reason === "NO_TASK_TO_CREATE")!.id;
    handleId = data!.find((row) => row.failure_reason === "AGENT_TIMEOUT")!.id;

    page = await browser.newPage();
    await signInThroughUi(page, carol.email, carol.password);
    await page.waitForURL("/dashboard");
  });

  test.afterAll(async () => {
    await page?.close();
    if (carol) await deleteUser(admin, carol.user.id);
  });

  test("사이드바 배지와 '오늘' 배너가 남은 건수를 말하고, [보기]가 그 보기로 간다", async () => {
    await page.goto("/dashboard");
    // 메뉴 순서 — '전체'와 '완료' 사이다(목업).
    await expect(menu().getByRole("link")).toHaveText(["오늘", "전체", /^확인 필요/, "완료", "히스토리", "설정"]);
    await expect(reviewLink()).toHaveText("확인 필요2");
    await expect(banner()).toContainText("확인이 필요한 캡처가 2건 있어요");

    // 배지는 다른 화면에서도 보인다.
    await page.goto("/history");
    await expect(reviewLink()).toHaveText("확인 필요2");
    // 배너는 '오늘'에만 선다.
    await page.goto("/dashboard?view=all");
    await expect(banner()).toHaveCount(0);

    await page.goto("/dashboard");
    await banner().getByRole("link", { name: "보기" }).click();
    await page.waitForURL(/\/dashboard\?view=review$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("확인 필요");
    await expect(reviewLink()).toHaveAttribute("aria-current", "page");

    // 최신순 · 히스토리와 같은 재료(요약·사유 문장). 요약이 없으면 그 사실을 말한다.
    await expect(reviewSection().getByRole("listitem")).toHaveCount(2);
    await expect(reviewSection().locator("li[data-log-id]").first()).toHaveAttribute("data-log-id", handleId);
    await expect(item(skipId)).toContainText("넘길 캡처. 과제 공지 같다.");
    await expect(item(skipId)).toContainText("생성할 태스크를 찾지 못했습니다.");
    await expect(item(handleId)).toContainText("캡처 내용이 기록되지 않았습니다.");
    await expect(item(handleId)).toContainText("처리 시간이 초과되었습니다.");
  });

  test("[넘기기]를 누르면 빠지고 건수가 준다 — 히스토리에는 남는다", async () => {
    await page.goto("/dashboard?view=review");
    await item(skipId).getByRole("button", { name: "넘기기" }).click();

    await expect(item(skipId)).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\?view=review$/);
    await expect(reviewLink()).toHaveText("확인 필요1");

    await page.goto("/history");
    await expect(page.locator(`li[data-log-id="${skipId}"]`)).toHaveCount(1);
  });

  test("[직접 처리]로 저장하면 빠지고, 0건이면 배지도 배너도 없다", async () => {
    await page.goto("/dashboard?view=review");
    await item(handleId).getByRole("link", { name: "직접 처리" }).click();
    await page.waitForURL(`/dashboard?view=review&new=1&from=${handleId}`);

    const panel = page.getByRole("complementary", { name: "태스크 상세" });
    await panel.getByLabel("제목").fill("손으로 만든 태스크");
    await panel.getByRole("button", { name: "추가" }).click();

    // 이 보기로 돌아와 방금 만든 태스크의 패널이 열리고, 항목은 빠져 있다.
    await expect(page).toHaveURL(/\/dashboard\?view=review&task=[0-9a-f-]{36}$/);
    await expect(panel.getByLabel("제목")).toHaveValue("손으로 만든 태스크");
    await expect(reviewSection().getByRole("listitem")).toHaveCount(0);
    await expect(reviewSection()).toContainText("확인할 캡처가 없습니다.");
    await expect(reviewLink()).toHaveText("확인 필요");

    await page.goto("/dashboard");
    await expect(banner()).toHaveCount(0);
  });

  test("좁은 화면(390px)에서도 가로로 넘치지 않는다", async () => {
    await carol.client.from("job_logs").insert({
      user_id: carol.user.id,
      source: "capture_create",
      outcome: "failed",
      failure_reason: "INTERNAL_ERROR",
      capture_summary: "좁은 화면 확인용 캡처.",
      created_at: AT(12),
    });

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const url of ["/dashboard", "/dashboard?view=review"]) {
        await page.goto(url);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${width}px ${url}`).toBeLessThanOrEqual(0);
        if (process.env.SHOTS) {
          await page.screenshot({ path: `${process.env.SHOTS}/${width}${url.replace(/\W+/g, "_")}.png`, fullPage: true });
        }
      }
    }
  });
});
