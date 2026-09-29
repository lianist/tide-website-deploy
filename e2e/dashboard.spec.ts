import { expect, test, type Locator, type Page } from "@playwright/test";

import { toDueAt } from "@/lib/time";

import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";
import { openTagFilter, signInThroughUi } from "./support/ui";

/**
 * L-P0-11 검증 — 대시보드 태스크 목록(`DASH-1` 정렬·강조, `DASH-2` 태그 표시·필터).
 * L-P1-10 — 보기(`DASH-9`). 두 구획이 한 화면에 서던 것이 세 보기로 갈렸다. 정렬·강조 검증은
 * '전체'(미완료 전부)와 '완료'에서 그대로 돌고, '오늘'의 경계는 아래 §보기에서 따로 박는다.
 *
 * 마감을 **실행 시점에 계산**한다. '오늘'은 고정할 수 없는 값이라 픽스처에 절대 날짜를 박으면
 * 하루 지나서 깨진다. 기준 시간대는 프로필에 명시적으로 심는다 — 가입 기본값에 기대면 그 값이
 * 바뀌는 날 조용히 깨진다.
 *
 * ⚠️ 자정 경계에서 한 번 흔들릴 수 있다(23:59:59 마감이 `today` → `overdue`로 넘어가는 순간,
 * 그리고 `A_MINUTE_AGO`가 어제가 되는 00:00~00:01 창). 없애려면 시계를 주입해야 하는데 그 값이
 * 이 루프의 비용을 넘어선다 — 확률 1/1440으로 받아들인다.
 */
test.describe.configure({ mode: "serial" });

const TZ = "Asia/Seoul";

/** `TZ` 기준 오늘에서 며칠 떨어진 날의 `YYYY-MM-DD`. */
const dayIn = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + offset * 86_400_000));

const YESTERDAY_9AM = toDueAt(dayIn(-1), "09:00", TZ)!;
/** 날짜만 있는 마감 = 그날 23:59:59. 그날 내내 `today`로 남는다(설계 결정 14). */
const TODAY_END = toDueAt(dayIn(0), null, TZ)!;
const TOMORROW_9AM = toDueAt(dayIn(1), "09:00", TZ)!;
/** 오늘인데 이미 지난 마감 — `overdue`가 `today`를 이긴다. */
const A_MINUTE_AGO = new Date(Date.now() - 60_000).toISOString();

test.describe("대시보드 태스크 목록", () => {
  let admin: DochiClient;
  let user: TestUser;
  let work: { id: string; name: string };
  let study: { id: string; name: string };
  let uncategorizedId: string;
  /**
   * 열두 테스트가 **한 번 로그인한 탭을 나눠 쓴다.** 테스트마다 로그인하면 Supabase Auth에
   * 열두 번 요청이 가고, 그것만으로 프로젝트의 요청 속도 제한에 닿아 다른 spec까지 함께
   * 떨어뜨린다(실측). 직렬 실행이라 탭을 공유해도 순서가 엉키지 않고, `beforeEach`가 매번
   * 대시보드로 돌려놓아 앞 테스트의 필터가 남지 않는다.
   */
  let page: Page;

  const todoSection = (page: Page) => page.getByRole("region", { name: "할 일" });
  const doneSection = (page: Page) => page.getByRole("region", { name: "완료" });
  const titlesOf = (section: Locator) => section.getByRole("heading", { level: 3 });

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);

    // 판정 기준을 명시한다 — 기본값이 바뀌어도 이 테스트의 뜻은 바뀌지 않아야 한다.
    await user.client.from("profiles").update({ timezone: TZ }).eq("id", user.user.id);

    const { data: tags, error: tagError } = await user.client
      .from("tags")
      .insert([
        { user_id: user.user.id, name: "업무" },
        { user_id: user.user.id, name: "학업" },
      ])
      .select("id, name");
    expect(tagError).toBeNull();
    work = tags!.find((tag) => tag.name === "업무")!;
    study = tags!.find((tag) => tag.name === "학업")!;

    const { data: uncategorized } = await user.client
      .from("tags")
      .select("id")
      .eq("name", "미분류")
      .single();
    uncategorizedId = uncategorized!.id;

    // RPC(`create_task`)로는 `status`도 `created_at`도 정할 수 없어 완료 태스크와 동률 타이브레이커를
    // 만들지 못한다. 화면이 지나는 것과 같은 RLS 경로로 직접 심는다.
    const { data: tasks, error } = await user.client
      .from("tasks")
      .insert([
        { user_id: user.user.id, title: "어제까지 서류 제출", due_at: YESTERDAY_9AM, due_has_time: true, status: "todo", source: "manual" },
        { user_id: user.user.id, title: "조금 전 마감 회신", due_at: A_MINUTE_AGO, due_has_time: true, status: "todo", source: "manual" },
        { user_id: user.user.id, title: "오늘까지 발표 자료", due_at: TODAY_END, due_has_time: false, status: "todo", source: "manual" },
        { user_id: user.user.id, title: "내일 아침 회의 준비", due_at: TOMORROW_9AM, due_has_time: true, status: "todo", source: "manual" },
        { user_id: user.user.id, title: "언젠가 도서관 책 반납", due_at: null, due_has_time: false, status: "todo", source: "manual" },
        { user_id: user.user.id, title: "지난주에 끝낸 회의록", due_at: YESTERDAY_9AM, due_has_time: true, status: "done", source: "capture_complete" },
        { user_id: user.user.id, title: "마감 없이 끝낸 메일 회신", due_at: null, due_has_time: false, status: "done", source: "capture_complete" },
        { user_id: user.user.id, title: "오늘 마감을 끝낸 보고", due_at: TODAY_END, due_has_time: false, status: "done", source: "manual" },
      ])
      .select("id, title");
    expect(error).toBeNull();

    const idOf = (title: string) => tasks!.find((task) => task.title === title)!.id;
    const { error: linkError } = await user.client.from("task_tags").insert([
      // 두 태그가 달린 태스크 — 필터를 걸어도 실린 태그가 잘리지 않는지 본다.
      { task_id: idOf("오늘까지 발표 자료"), tag_id: work.id, user_id: user.user.id },
      { task_id: idOf("오늘까지 발표 자료"), tag_id: study.id, user_id: user.user.id },
      { task_id: idOf("내일 아침 회의 준비"), tag_id: work.id, user_id: user.user.id },
    ]);
    expect(linkError).toBeNull();
  });

  test.afterAll(async () => {
    await page?.close();
    if (user) await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
  });

  test.beforeEach(async ({ browser }) => {
    if (!page) {
      page = await browser.newPage();
      await signInThroughUi(page, user.email, user.password);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    // 앞 테스트가 걸어 둔 필터를 지우고 같은 출발선으로 돌아온다. 정렬·강조 검증의 출발선은
    // 미완료 전부가 서는 '전체'다.
    await page.goto("/dashboard?view=all");
  });

  test("'전체'는 미완료 전부, '완료'는 완료 전부다", async () => {
    await expect(titlesOf(todoSection(page))).toHaveCount(5);
    await expect(doneSection(page)).toHaveCount(0);

    await page.goto("/dashboard?view=done");
    await expect(titlesOf(doneSection(page))).toHaveCount(3);
    await expect(todoSection(page)).toHaveCount(0);
  });

  test("각 섹션이 마감 임박 순이고, 마감 없는 것은 끝이다", async () => {
    await expect(titlesOf(todoSection(page))).toHaveText([
      "어제까지 서류 제출",
      "조금 전 마감 회신",
      "오늘까지 발표 자료",
      "내일 아침 회의 준비",
      "언젠가 도서관 책 반납",
    ]);
    await page.goto("/dashboard?view=done");
    await expect(titlesOf(doneSection(page))).toHaveText([
      "지난주에 끝낸 회의록",
      "오늘 마감을 끝낸 보고",
      "마감 없이 끝낸 메일 회신",
    ]);
  });

  test("마감 지남·오늘 마감만 강조되고, 완료 섹션에는 강조가 없다", async () => {
    const todo = todoSection(page);

    await expect(todo.locator('[data-due="overdue"]')).toHaveCount(2);
    await expect(todo.locator('[data-due="today"]')).toHaveCount(1);
    await expect(todo.locator('[data-due="upcoming"]')).toHaveCount(1);
    await expect(todo.locator('[data-due="none"]')).toHaveCount(1);

    await expect(todo.locator('[data-due="today"]').getByRole("heading", { level: 3 })).toHaveText(
      "오늘까지 발표 자료",
    );
    await expect(todo.locator('[data-due="none"]').getByRole("heading", { level: 3 })).toHaveText(
      "언젠가 도서관 책 반납",
    );

    // 완료된 태스크에 "마감 지남"은 거짓이다.
    await page.goto("/dashboard?view=done");
    await expect(doneSection(page).locator("[data-due]")).toHaveCount(0);
    await expect(doneSection(page)).not.toContainText("마감 지남");
  });

  test("오늘이면서 이미 지난 마감은 overdue다", async () => {
    const overdue = todoSection(page).locator('[data-due="overdue"]');
    await expect(overdue.getByRole("heading", { level: 3 })).toHaveText([
      "어제까지 서류 제출",
      "조금 전 마감 회신",
    ]);
  });

  test("강조가 실제로 칠해진다", async () => {
    const todo = todoSection(page);
    // 정확한 색값을 보지 않는다 — Tailwind v4는 oklch로 내고 직렬화가 브라우저에 달렸다.
    // 확인할 것은 세 단계가 서로 다른 색으로 그려진다는 사실뿐이다.
    const colorOf = (state: string) =>
      todo.locator(`[data-due="${state}"] p`).first().evaluate((el) => getComputedStyle(el).color);

    const [overdue, today, upcoming] = await Promise.all([
      colorOf("overdue"),
      colorOf("today"),
      colorOf("upcoming"),
    ]);
    expect(new Set([overdue, today, upcoming]).size).toBe(3);
  });

  test("날짜만 있는 마감은 시각을 감춘다", async () => {
    const row = todoSection(page).locator('[data-due="today"]');
    await expect(row).toContainText("오늘 마감 · ");
    // 23:59:59가 들어 있지만 `dueHasTime`이 false라 시각은 화면에 없다(계약 §태스크).
    await expect(row).not.toContainText(":");

    // 시각이 있는 마감은 반대로 시각까지 보인다.
    await expect(todoSection(page).locator('[data-due="upcoming"]')).toContainText("09:00");
  });

  test("각 태스크에 태그가 보인다", async () => {
    const row = todoSection(page).locator('[data-due="today"]');
    await expect(row).toContainText("업무");
    await expect(row).toContainText("학업");

    // 태그가 없는 태스크에는 아무 칩도 없다.
    await expect(todoSection(page).locator('[data-due="none"]')).not.toContainText("업무");
  });

  test("태그 칩을 누르면 그 태그의 태스크만 남고, 실린 태그는 잘리지 않는다", async () => {
    // 태그를 고르지 않은 대시보드에서는 구획이 접혀 있다(HF-12).
    await openTagFilter(page);
    await page.getByRole("navigation", { name: "태그 필터" }).getByRole("link", { name: "학업" }).click();
    // 태그는 보기를 다시 좁힌다 — 고른 보기가 주소에 남는다(`DASH-9`).
    await page.waitForURL(new RegExp(`\\?view=all&tag=${study.id}$`));

    await expect(titlesOf(todoSection(page))).toHaveText(["오늘까지 발표 자료"]);
    // '학업'으로 걸렀어도 그 태스크의 '업무'는 남아 있어야 한다.
    await expect(todoSection(page).locator('[data-due="today"]')).toContainText("업무");
    // 완료 보기도 같은 필터를 받는다 — 이 태그가 달린 완료 태스크는 없다.
    await page.goto(`/dashboard?view=done&tag=${study.id}`);
    await expect(titlesOf(doneSection(page))).toHaveCount(0);
  });

  test("전체로 돌아오면 필터가 풀린다", async () => {
    await page.goto(`/dashboard?view=all&tag=${work.id}`);
    await expect(titlesOf(todoSection(page))).toHaveCount(2);

    const nav = page.getByRole("navigation", { name: "태그 필터" });
    await expect(nav.getByRole("link", { name: "업무" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "전체" }).click();
    await page.waitForURL(/\/dashboard\?view=all$/);
    await expect(titlesOf(todoSection(page))).toHaveCount(5);
    // 필터가 풀리면 구획도 접힌 채로 그려진다(HF-12).
    await openTagFilter(page);
    await expect(nav.getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
  });

  test("걸린 태스크가 없는 태그는 필터용 빈 문구를 낸다", async () => {
    await page.goto(`/dashboard?view=all&tag=${uncategorizedId}`);
    await expect(todoSection(page)).toContainText("이 태그에 해당하는 태스크가 없습니다.");

    await page.goto(`/dashboard?view=done&tag=${uncategorizedId}`);
    await expect(doneSection(page)).toContainText("이 태그에 해당하는 태스크가 없습니다.");
  });

  test("모르는 tag 값은 무시하고 전체를 보여 준다", async () => {
    // 주소창은 사람이 고치는 자리다 — 400도 빈 화면도 내지 않는다.
    for (const query of ["&tag=not-a-uuid", `&tag=${work.id}&tag=${study.id}`]) {
      await page.goto(`/dashboard?view=all${query}`);
      await expect(titlesOf(todoSection(page))).toHaveCount(5);
    }
  });

  /**
   * 강조 단계는 절대 시각 비교라 시간대로 흔들리지 않는다. 시간대가 바꾸는 것은 **표시**다 —
   * 서울 09:00은 키리바시(UTC+14)에서 14:00이고 UTC에서는 00:00이다. 셋이 서로 달라서, 화면이
   * 서버 시간대(Vercel은 UTC)나 브라우저 시간대를 쓰고 있으면 여기서 반드시 갈라진다.
   */
  test("날짜 표시가 profiles.timezone을 따른다", async () => {
    const overdueFirst = () => todoSection(page).locator('[data-due="overdue"]').first();
    await expect(overdueFirst()).toContainText("09:00");

    await user.client.from("profiles").update({ timezone: "Pacific/Kiritimati" }).eq("id", user.user.id);
    try {
      await page.reload();
      await expect(overdueFirst()).toContainText("14:00");
      await expect(overdueFirst()).not.toContainText("09:00");
    } finally {
      await user.client.from("profiles").update({ timezone: TZ }).eq("id", user.user.id);
    }
  });

  /**
   * 보기(`DASH-9`) — '오늘'은 마감이 오늘이거나 이미 지난 미완료 + 마감이 오늘인 완료(취소선).
   * 경계 사례: 오늘 23:59:59 마감(날짜만) · 어제 마감 미완료 · 어제 마감 완료 · 마감 없음 · 내일.
   * "오늘"은 계정 시간대의 하루다(시드가 서울 기준으로 계산돼 있다).
   */
  test("'오늘'은 맨 /dashboard이고, 경계가 DASH-9 그대로다", async () => {
    await page.goto("/dashboard");
    const today = page.getByRole("region", { name: "오늘" });

    await expect(titlesOf(today)).toHaveText([
      "어제까지 서류 제출", // 어제 마감 미완료 — 든다
      "조금 전 마감 회신", // 오늘이면서 지난 마감 — 든다
      "오늘까지 발표 자료", // 오늘 23:59:59(날짜만) — 든다
      "오늘 마감을 끝낸 보고", // 마감이 오늘인 완료 — 든다(취소선)
    ]);
    // 내일 마감·마감 없음·어제 마감 완료·마감 없는 완료는 빠진다.
    await expect(today).not.toContainText("내일 아침 회의 준비");
    await expect(today).not.toContainText("언젠가 도서관 책 반납");
    await expect(today).not.toContainText("지난주에 끝낸 회의록");

    // 완료 행은 강조 없이 취소선이다. 강조(`DASH-1`)는 '오늘'에서도 그대로다.
    const doneRow = today.getByRole("listitem").filter({ hasText: "오늘 마감을 끝낸 보고" });
    await expect(doneRow).not.toHaveAttribute("data-due");
    await expect(doneRow.getByRole("heading", { level: 3 })).toHaveClass(/line-through/);
    await expect(today.locator('[data-due="overdue"]')).toHaveCount(2);
    await expect(today.locator('[data-due="today"]')).toHaveCount(1);
  });

  test("주요 메뉴가 보기를 고르고, 헤더 제목이 따라온다", async () => {
    const menu = page.getByRole("navigation", { name: "주요 메뉴" });
    for (const [label, url, heading] of [
      ["오늘", /\/dashboard$/, "오늘 할 일"],
      ["완료", /\/dashboard\?view=done$/, "완료한 일"],
      ["전체", /\/dashboard\?view=all$/, "전체 할 일"],
    ] as const) {
      await menu.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(menu.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
  });

  test("보기와 태그를 함께 고른 주소가 동작한다", async () => {
    await page.goto(`/dashboard?tag=${work.id}`);
    // '오늘' + '업무' — 오늘 마감인 '업무' 태스크 하나뿐이다(내일 것은 '오늘'이 걸러 낸다).
    await expect(titlesOf(page.getByRole("region", { name: "오늘" }))).toHaveText(["오늘까지 발표 자료"]);
    // 태그 링크가 보기를 나른다.
    await expect(
      page.getByRole("navigation", { name: "태그 필터" }).getByRole("link", { name: "학업" }),
    ).toHaveAttribute("href", `/dashboard?tag=${study.id}`);
  });
});
