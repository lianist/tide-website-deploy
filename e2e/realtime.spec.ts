import { expect, test, type Locator, type Page } from "@playwright/test";

import { toDueAt } from "@/lib/time";

import { bearer, dataOf } from "./support/api";
import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";
import { plantProbe, readProbe, signInThroughUi } from "./support/ui";

/**
 * L-P0-13 검증 — 실시간 반영(`DASH-5`).
 *
 * **브라우저를 건드리지 않고 다른 경로(HTTP API)로 데이터를 바꾼 뒤 화면이 스스로 따라오는지**를
 * 본다. 앱이 캡처를 보내 태스크가 생기는 상황과 같은 모양이다 — 대시보드는 그 요청에 관여하지
 * 않는다.
 *
 * `page.reload()`를 부르지 않는 것만으로는 "새로고침이 없었다"를 증명하지 못한다(코드가 스스로
 * 재로드할 수도 있다). 그래서 `window`에 표식을 하나 심고, 화면이 바뀐 뒤에도 그 표식이 살아
 * 있는지 본다 — 전체 재로드였다면 사라진다.
 */
test.describe.configure({ mode: "serial" });

test.describe("실시간 반영", () => {
  let admin: DochiClient;
  let user: TestUser;
  /** 남의 변경이 이 화면에 새지 않는지 보는 쪽. 화면 로그인은 하지 않는다(Auth 요청 절약). */
  let other: TestUser;
  let workTagId: string;
  /** 세 테스트가 한 번 로그인한 탭을 나눠 쓴다 — `dashboard.spec.ts`와 같은 이유(속도 제한). */
  let page: Page;

  const todoSection = (page: Page) => page.getByRole("region", { name: "할 일" });
  const doneSection = (page: Page) => page.getByRole("region", { name: "완료" });
  const titlesOf = (section: Locator) => section.getByRole("heading", { level: 3 });

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
    other = await createSignedInUser(admin);

    const { data: tag, error } = await user.client
      .from("tags")
      .insert({ user_id: user.user.id, name: "업무" })
      .select("id")
      .single();
    expect(error).toBeNull();
    workTagId = tag!.id;
  });

  test.afterAll(async () => {
    await page?.close();
    await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    await admin.auth.admin.deleteUser(other.user.id).catch(() => undefined);
  });

  test.beforeEach(async ({ browser }) => {
    if (!page) {
      page = await browser.newPage();
      await signInThroughUi(page, user.email, user.password);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    // 시드 태스크에 마감이 없다 — 미완료 전부가 서는 '전체' 보기에서 본다(`L-P1-10`).
    await page.goto("/dashboard?view=all");
  });

  test("다른 경로로 생긴 태스크가 새로고침 없이 나타난다", async ({ request }) => {
    await expect(todoSection(page)).toBeVisible();
    const probe = await plantProbe(page);

    const created = await dataOf<{ id: string }>(
      await request.post("/api/v1/tasks", {
        headers: bearer(user.accessToken),
        data: { title: "캡처가 만든 태스크", tagIds: [workTagId] },
      }),
    );
    expect(created.id).toBeTruthy();

    // 화면에 손대지 않았는데 행이 생긴다.
    await expect(titlesOf(todoSection(page))).toHaveText(["캡처가 만든 태스크"]);

    // **태그 칩까지 보인다** = 목록이 서버의 `listTasks`/`toTaskPayload`를 다시 지났다는 증거다.
    // Realtime 페이로드에는 `task_tags(tags(...))` 조인이 없어서, 클라이언트가 페이로드로 행을
    // 그렸다면 이 칩이 없다.
    await expect(todoSection(page).getByText("업무")).toBeVisible();

    // 전체 재로드가 아니었다.
    expect(await readProbe(page)).toBe(probe);
  });

  test("완료로 바뀐 태스크가 즉시 '전체'에서 빠지고 '완료'에 선다", async ({ request }) => {
    const created = await dataOf<{ id: string }>(
      await request.post("/api/v1/tasks", {
        headers: bearer(user.accessToken),
        data: { title: "완료될 태스크" },
      }),
    );
    // 목록에 자리 잡은 뒤에 시작한다 — 생성 이벤트와 완료 이벤트가 겹치지 않게.
    await expect(titlesOf(todoSection(page))).toContainText(["완료될 태스크"]);
    const probe = await plantProbe(page);

    await dataOf(
      await request.patch(`/api/v1/tasks/${created.id}`, {
        headers: bearer(user.accessToken),
        data: { status: "done" },
      }),
    );

    await expect(titlesOf(todoSection(page))).not.toContainText(["완료될 태스크"]);
    expect(await readProbe(page)).toBe(probe);

    await page.goto("/dashboard?view=done");
    await expect(titlesOf(doneSection(page))).toContainText(["완료될 태스크"]);
  });

  test("'오늘'과 '완료' 보기에서도 새로고침 없이 따라온다", async ({ request }) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    // 날짜만 있는 마감 = 그날 23:59:59(설계 결정 14) — 자정 직전이 아니면 '오늘'에 든다.
    const dueAt = toDueAt(today, null, "Asia/Seoul");
    await user.client.from("profiles").update({ timezone: "Asia/Seoul" }).eq("id", user.user.id);

    await page.goto("/dashboard");
    const todayRegion = page.getByRole("region", { name: "오늘" });
    await expect(todayRegion).toBeVisible();
    let probe = await plantProbe(page);
    const created = await dataOf<{ id: string }>(
      await request.post("/api/v1/tasks", {
        headers: bearer(user.accessToken),
        data: { title: "오늘 마감 실시간", dueAt, dueHasTime: false },
      }),
    );
    await expect(titlesOf(todayRegion)).toContainText(["오늘 마감 실시간"]);
    expect(await readProbe(page)).toBe(probe);

    await page.goto("/dashboard?view=done");
    probe = await plantProbe(page);
    await dataOf(
      await request.patch(`/api/v1/tasks/${created.id}`, {
        headers: bearer(user.accessToken),
        data: { status: "done" },
      }),
    );
    await expect(titlesOf(doneSection(page))).toContainText(["오늘 마감 실시간"]);
    expect(await readProbe(page)).toBe(probe);
  });

  test("남의 태스크는 이 화면을 바꾸지 않는다", async ({ request }) => {
    const before = await titlesOf(todoSection(page)).allTextContents();

    // **순서가 핵심이다.** 남의 것을 먼저 만들고 내 것을 나중에 만든다. 내 것이 화면에 도착했다는
    // 것은 더 나중에 쓰인 변경이 이미 왕복을 마쳤다는 뜻이라, 앞선 남의 변경은 올 것이었다면
    // 진작 왔다. 임의의 `waitForTimeout` 없이 "오지 않았다"의 대기 시간을 묶는 방법이다.
    await dataOf(
      await request.post("/api/v1/tasks", {
        headers: bearer(other.accessToken),
        data: { title: "남의 태스크 — 새면 안 된다" },
      }),
    );
    await dataOf(
      await request.post("/api/v1/tasks", {
        headers: bearer(user.accessToken),
        data: { title: "내 태스크 — 도착 신호" },
      }),
    );

    await expect(titlesOf(todoSection(page))).toHaveText([...before, "내 태스크 — 도착 신호"]);
    await expect(page.getByText("남의 태스크")).toHaveCount(0);
  });
});
