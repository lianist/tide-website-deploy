import { expect, test, type Locator, type Page } from "@playwright/test";

import { toDueAt } from "@/lib/time";

import {
  createAdminClient,
  createSignedInUser,
  type DochiClient,
  type TestUser,
} from "./support/supabase";
import { signInThroughUi } from "./support/ui";

/**
 * L-P0-12 검증 — 태스크 상세 패널(`DASH-3`)과 직접 CRUD(`DASH-4`).
 *
 * `dashboard.spec.ts`와 같은 규약이다: 직렬 실행 + **파일당 로그인 1회**. 테스트마다 로그인하면
 * Supabase Auth의 요청 속도 제한에 닿아 다른 spec까지 함께 떨어진다(거기 주석에 실측 기록이 있다).
 *
 * **고치는 테스트는 저마다 태스크를 새로 만든다.** 시드 하나를 돌려 쓰면 앞 테스트의 수정이
 * 뒤 테스트의 전제를 바꿔, 순서를 건드리는 순간 무너진다.
 */
test.describe.configure({ mode: "serial" });

const TZ = "Asia/Seoul";

const dayIn = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

test.describe("태스크 상세 패널", () => {
  let admin: DochiClient;
  let user: TestUser;
  let other: TestUser;
  let workTagId: string;
  let studyTagId: string;
  let page: Page;

  const panel = (page: Page) => page.getByRole("complementary", { name: "태스크 상세" });
  const todoSection = (page: Page) => page.getByRole("region", { name: "할 일" });
  const doneSection = (page: Page) => page.getByRole("region", { name: "완료" });
  const titlesOf = (section: Locator) => section.getByRole("heading", { level: 3 });

  /** 태스크 한 건을 RLS 경로로 직접 넣는다 — RPC로는 `source`·`rationale`을 정할 수 없다. */
  async function seedTask(fields: {
    title: string;
    description?: string | null;
    dueAt?: string | null;
    dueHasTime?: boolean;
    rationale?: string | null;
    source?: "capture_create" | "manual";
    tagIds?: string[];
    owner?: TestUser;
  }): Promise<string> {
    const owner = fields.owner ?? user;
    const { data, error } = await owner.client
      .from("tasks")
      .insert({
        user_id: owner.user.id,
        title: fields.title,
        description: fields.description ?? null,
        due_at: fields.dueAt ?? null,
        due_has_time: fields.dueHasTime ?? false,
        rationale: fields.rationale ?? null,
        source: fields.source ?? "manual",
      })
      .select("id")
      .single();
    if (error) throw error;

    for (const tagId of fields.tagIds ?? []) {
      const { error: linkError } = await owner.client
        .from("task_tags")
        .insert({ task_id: data.id, tag_id: tagId, user_id: owner.user.id });
      if (linkError) throw linkError;
    }
    return data.id;
  }

  /**
   * 지금 화면의 패널이 그 태스크의 것인지. 저장 뒤에는 URL이 canonical로 돌아온다.
   *
   * '전체' 보기에서 연다(`L-P1-10`) — 시드한 태스크 대부분이 마감이 없어 기본 보기('오늘')의
   * 목록에 서지 않는다. 옛 주소(`/dashboard?task=`)가 그대로 여는지는 맨 끝 딥링크 테스트가 본다.
   */
  const openTask = async (id: string, query = "") => {
    await page.goto(`/dashboard?view=all&task=${id}${query}`);
    await expect(panel(page)).toBeVisible();
  };

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
    other = await createSignedInUser(admin);

    // 판정 기준을 명시한다 — 가입 기본값이 바뀌어도 이 테스트의 뜻은 바뀌지 않아야 한다.
    await user.client.from("profiles").update({ timezone: TZ }).eq("id", user.user.id);

    const { data: tags, error } = await user.client
      .from("tags")
      .insert([
        { user_id: user.user.id, name: "업무" },
        { user_id: user.user.id, name: "학업" },
      ])
      .select("id, name");
    if (error) throw error;

    workTagId = tags.find((t) => t.name === "업무")!.id;
    studyTagId = tags.find((t) => t.name === "학업")!.id;
  });

  test.beforeEach(async ({ browser }) => {
    if (!page) {
      page = await browser.newPage();
      await signInThroughUi(page, user.email, user.password);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
  });

  test.afterAll(async () => {
    await page?.close();
    await admin.auth.admin.deleteUser(user.user.id);
    await admin.auth.admin.deleteUser(other.user.id);
  });

  test("행을 누르면 URL에 태스크 id가 실리고 패널이 열린다", async () => {
    const id = await seedTask({ title: "행 클릭 대상" });
    await page.goto("/dashboard?view=all");

    await todoSection(page).getByRole("link", { name: "행 클릭 대상 상세" }).click();

    await expect(page).toHaveURL(new RegExp(`[?&]task=${id}$`));
    await expect(panel(page).getByLabel("제목")).toHaveValue("행 클릭 대상");
  });

  // HF-08 — 다른 행을 눌러도 입력칸이 앞 태스크 값에 머물렀다. 행 클릭은 클라이언트 전환이라
  // `goto`로 여는 다른 테스트들은 이 경로를 지나지 않는다. 그래서 여기서는 `goto`를 한 번만 한다.
  test("열린 패널에서 다른 행을 누르면 입력칸도 그 태스크로 바뀐다", async () => {
    await seedTask({ title: "전환 앞", description: "앞 설명", dueAt: toDueAt(dayIn(1), "09:00", TZ) });
    await seedTask({ title: "전환 뒤", description: "뒤 설명", dueAt: toDueAt(dayIn(3), "09:00", TZ) });
    await page.goto("/dashboard?view=all");

    await todoSection(page).getByRole("link", { name: "전환 앞 상세" }).click();
    await expect(panel(page).getByLabel("제목")).toHaveValue("전환 앞");

    await todoSection(page).getByRole("link", { name: "전환 뒤 상세" }).click();
    const detail = panel(page);
    await expect(detail.getByLabel("제목")).toHaveValue("전환 뒤");
    await expect(detail.getByLabel("설명")).toHaveValue("뒤 설명");
    await expect(detail.getByLabel("마감 날짜")).toHaveValue(dayIn(3));
  });

  test("패널에 6개 항목이 전부 있다", async () => {
    const id = await seedTask({
      title: "에이전트가 만든 것",
      description: "캡처에서 읽어낸 설명",
      dueAt: toDueAt(dayIn(1), "09:00", TZ),
      dueHasTime: true,
      rationale: "'금요일까지 제출' 문구가 있었다",
      source: "capture_create",
      tagIds: [workTagId],
    });
    await openTask(id);

    const detail = panel(page);
    // 제목·설명·마감일·상태 — 사용자가 고치는 넷
    await expect(detail.getByLabel("제목")).toHaveValue("에이전트가 만든 것");
    await expect(detail.getByLabel("설명")).toHaveValue("캡처에서 읽어낸 설명");
    await expect(detail.getByLabel("마감 날짜")).toHaveValue(dayIn(1));
    await expect(detail.getByLabel("마감 시각")).toHaveValue("09:00");
    await expect(detail.getByText("마감일", { exact: true })).toBeVisible();
    await expect(detail.getByText("상태", { exact: true })).toBeVisible();

    // 🔴 태그 칸은 없다(2026-09-26). 걸린 태그는 목록 행의 칩으로만 보인다.
    await expect(detail.getByText("태그", { exact: true })).toHaveCount(0);
    await expect(detail.getByRole("checkbox")).toHaveCount(0);

    // 근거·생성 경로 — 에이전트 판단을 사후에 교정하기 위한 둘. 빠지면 `DASH-3` 위반이다.
    await expect(detail.getByText("근거", { exact: true })).toBeVisible();
    await expect(detail.getByText("'금요일까지 제출' 문구가 있었다")).toBeVisible();
    await expect(detail.getByText("생성 경로", { exact: true })).toBeVisible();
    await expect(detail.getByText("캡처 (생성)")).toBeVisible();
  });

  test("직접 추가한 태스크도 근거·생성 경로 자리가 남는다", async () => {
    const id = await seedTask({ title: "직접 만든 것" });
    await openTask(id);

    const detail = panel(page);
    await expect(detail.getByText("근거", { exact: true })).toBeVisible();
    await expect(detail.getByText("에이전트가 남긴 근거가 없습니다.")).toBeVisible();
    await expect(detail.getByText("직접 추가", { exact: true })).toBeVisible();
  });

  test("없는 id·남의 태스크·UUID 아닌 값은 모두 같은 '찾을 수 없음'이다", async () => {
    const strangers = [
      "00000000-0000-4000-8000-000000000000",
      await seedTask({ title: "남의 태스크", owner: other }),
      "not-a-uuid",
    ];

    for (const id of strangers) {
      await page.goto(`/dashboard?task=${id}`);
      await expect(panel(page)).toContainText("태스크를 찾을 수 없습니다.");
    }
  });

  test("새 태스크를 만들면 그 패널이 열린 채 목록에 나타난다", async () => {
    await page.goto("/dashboard?view=all&new=1");

    const detail = panel(page);
    await detail.getByLabel("제목").fill("직접 추가한 태스크");
    await detail.getByLabel("마감 날짜").fill(dayIn(2));
    await detail.getByRole("button", { name: "추가" }).click();

    await expect(page).toHaveURL(/\?view=all&task=[0-9a-f-]{36}$/);
    await expect(detail.getByLabel("제목")).toHaveValue("직접 추가한 태스크");
    await expect(detail.getByText("직접 추가", { exact: true })).toBeVisible();
    await expect(titlesOf(todoSection(page))).toContainText(["직접 추가한 태스크"]);
  });

  test("제목과 설명을 고쳐 저장하면 패널과 목록에 함께 반영된다", async () => {
    const id = await seedTask({ title: "고치기 전", description: "옛 설명" });
    await openTask(id);

    const detail = panel(page);
    await detail.getByLabel("제목").fill("고친 뒤");
    await detail.getByLabel("설명").fill("새 설명");
    await detail.getByRole("button", { name: "저장" }).click();

    await expect(page).toHaveURL(new RegExp(`[?&]task=${id}$`));
    await expect(detail.getByLabel("설명")).toHaveValue("새 설명");
    await expect(titlesOf(todoSection(page))).toContainText(["고친 뒤"]);
  });

  test("마감을 날짜만 · 시각까지 · 비움으로 왕복한다", async () => {
    const id = await seedTask({ title: "마감 왕복" });
    const row = () => todoSection(page).locator(`[data-due]`).filter({ hasText: "마감 왕복" });
    await openTask(id);

    const detail = panel(page);

    // 날짜만 — 그날 23:59:59에 놓이므로 오늘로 잡으면 하루 내내 `today`이고 시각은 감춘다.
    await detail.getByLabel("마감 날짜").fill(dayIn(0));
    await detail.getByRole("button", { name: "저장" }).click();
    await expect(row()).toHaveAttribute("data-due", "today");
    await expect(row()).not.toContainText(":");

    // 시각까지 — `dueHasTime`이 켜지며 표시에 시각이 붙는다.
    await detail.getByLabel("마감 시각").fill("18:30");
    await detail.getByRole("button", { name: "저장" }).click();
    await expect(row()).toContainText("18:30");

    // 비움 — 마감 없는 태스크는 목록의 끝으로 간다(`DASH-1`).
    await detail.getByLabel("마감 날짜").fill("");
    await detail.getByLabel("마감 시각").fill("");
    await detail.getByRole("button", { name: "저장" }).click();
    await expect(row()).toHaveAttribute("data-due", "none");
    await expect(titlesOf(todoSection(page)).last()).toHaveText("마감 왕복");
  });

  test("날짜 없이 시각만 고르면 조용히 버리지 않고 알린다", async () => {
    const id = await seedTask({ title: "시각만" });
    await openTask(id);

    const detail = panel(page);
    await detail.getByLabel("마감 시각").fill("09:00");
    await detail.getByRole("button", { name: "저장" }).click();

    await expect(detail.getByRole("alert")).toContainText("날짜를 함께 골라 주세요");
    // 마감이 붙지 않았다 — 실패는 아무것도 바꾸지 않는다.
    const { data } = await user.client.from("tasks").select("due_at").eq("id", id).single();
    expect(data?.due_at).toBeNull();
  });

  /**
   * 🔴 **태그 칸을 뺀 자리의 가드다**(2026-09-26). 폼에 체크박스가 없으므로 `saveTask`가 `tagIds`를
   * 계속 실어 보냈다면 빈 배열이 나가 **저장 한 번에 태그가 전부 떨어진다.** `patchTask`는 `tagIds`가
   * 오면 그대로 덮어쓰기 때문이다. 화면에서 지워진 칸이라 눈으로는 안 보이는 고장이다.
   */
  test("제목만 고쳐 저장해도 걸려 있던 태그가 남는다", async () => {
    const id = await seedTask({ title: "태그 보존", tagIds: [workTagId] });
    const row = () => todoSection(page).locator("[data-due]").filter({ hasText: "태그 보존" });
    await expect(row()).toContainText("업무");

    await openTask(id);
    const detail = panel(page);
    await detail.getByLabel("제목").fill("태그 보존 · 고친 뒤");
    await detail.getByRole("button", { name: "저장" }).click();

    const after = () =>
      todoSection(page).locator("[data-due]").filter({ hasText: "태그 보존 · 고친 뒤" });
    await expect(after()).toContainText("업무");
  });

  /*
    HF-10 — HF-03이 뺀 태그 칸을 단일 선택으로 되돌렸다. 단일 선택이 **여러 태그를 하나로 줄이지
    않는지**가 가장 조용히 깨질 수 있는 자리다(에이전트는 태그 둘을 달 수 있다).
  */
  test("태그가 둘인 태스크를 제목만 고쳐 저장해도 태그 둘이 다 남는다", async () => {
    const id = await seedTask({ title: "태그 둘", tagIds: [workTagId, studyTagId] });
    await openTask(id);
    const detail = panel(page);
    await detail.getByLabel("제목").fill("태그 둘 · 고친 뒤");
    await detail.getByRole("button", { name: "저장" }).click();

    const after = todoSection(page).locator("[data-due]").filter({ hasText: "태그 둘 · 고친 뒤" });
    await expect(after).toContainText("업무");
    await expect(after).toContainText("학업");
  });

  test("태그를 골라 저장하면 그 태그로 바뀐다", async () => {
    const id = await seedTask({ title: "태그 바꾸기", tagIds: [workTagId] });
    await openTask(id);
    const detail = panel(page);
    await expect(detail.getByLabel("태그", { exact: true })).toHaveValue(workTagId);

    await detail.getByLabel("태그", { exact: true }).selectOption({ label: "학업" });
    await detail.getByRole("button", { name: "저장" }).click();

    const row = todoSection(page).locator("[data-due]").filter({ hasText: "태그 바꾸기" });
    await expect(row).toContainText("학업");
    await expect(row).not.toContainText("업무");
    await expect(detail.getByLabel("태그", { exact: true })).toHaveValue(studyTagId);
  });

  test("새 태그 이름을 넣으면 태그가 생겨 붙고, 같은 이름을 다시 넣으면 그 태그를 쓴다", async () => {
    const first = await seedTask({ title: "새 태그 첫째" });
    await openTask(first);
    await panel(page).getByLabel("새 태그").fill("동호회");
    await panel(page).getByRole("button", { name: "저장" }).click();
    await expect(
      todoSection(page).locator("[data-due]").filter({ hasText: "새 태그 첫째" }),
    ).toContainText("동호회");

    const second = await seedTask({ title: "새 태그 둘째" });
    await openTask(second);
    await panel(page).getByLabel("새 태그").fill("동호회");
    await panel(page).getByRole("button", { name: "저장" }).click();
    await expect(
      todoSection(page).locator("[data-due]").filter({ hasText: "새 태그 둘째" }),
    ).toContainText("동호회");

    const { data } = await user.client.from("tags").select("id").eq("name", "동호회");
    expect(data).toHaveLength(1);
  });

  test("새 태스크를 만들 때 고른 태그가 붙는다", async () => {
    await page.goto("/dashboard?view=all&new=1");
    const detail = panel(page);
    await detail.getByLabel("제목").fill("태그 골라 추가");
    await detail.getByLabel("태그", { exact: true }).selectOption({ label: "학업" });
    await detail.getByRole("button", { name: "추가" }).click();

    await expect(page).toHaveURL(/\?view=all&task=[0-9a-f-]{36}$/);
    await expect(
      todoSection(page).locator("[data-due]").filter({ hasText: "태그 골라 추가" }),
    ).toContainText("학업");
  });

  test("패널의 완료 표시로 보냈다가 되돌릴 수 있다", async () => {
    const id = await seedTask({ title: "상태 왕복" });
    await openTask(id);

    const detail = panel(page);
    // 옛 버튼([할 일로]·[완료로])은 사라졌다(`DASH-10`) — 행과 같은 완료 표시가 제목 앞에 선다.
    await expect(page.getByRole("button", { name: /^(완료로|할 일로)$/ })).toHaveCount(0);

    const toggle = detail.getByRole("button", { name: "완료로 표시", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();

    // '전체'(미완료)에서 빠지지만 패널은 그 태스크로 열려 있고, 상태를 글자로 보여 준다(`DASH-3`).
    await expect(titlesOf(todoSection(page))).not.toContainText(["상태 왕복"]);
    await expect(page).toHaveURL(new RegExp(`[?&]task=${id}$`));
    await expect(detail.getByRole("button", { name: "미완료로 되돌리기", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto(`/dashboard?view=done&task=${id}`);
    await expect(titlesOf(doneSection(page))).toContainText(["상태 왕복"]);
    // 강조는 미완료의 것이다 — 완료 목록에는 속성 자체가 없다.
    await expect(doneSection(page).locator("[data-due]")).toHaveCount(0);

    await detail.getByRole("button", { name: "미완료로 되돌리기", exact: true }).click();
    await expect(titlesOf(doneSection(page))).not.toContainText(["상태 왕복"]);
    await expect(detail.getByRole("button", { name: "완료로 표시", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("행의 동그라미로 완료했다가 되돌리고, 열린 패널과 보기는 그대로다", async () => {
    const opened = await seedTask({ title: "열어 둔 것" });
    await seedTask({ title: "행에서 체크" });
    await openTask(opened);

    await todoSection(page).getByRole("button", { name: "행에서 체크 완료로 표시" }).click();
    await expect(titlesOf(todoSection(page))).not.toContainText(["행에서 체크"]);
    // 누른 태스크의 패널로 넘어가지 않는다 — 누르기 전에 열려 있던 패널과 보기로 돌아온다.
    await expect(page).toHaveURL(new RegExp(`\\?view=all&task=${opened}$`));
    await expect(panel(page).getByLabel("제목")).toHaveValue("열어 둔 것");

    await page.goto("/dashboard?view=done");
    await doneSection(page).getByRole("button", { name: "행에서 체크 미완료로 되돌리기" }).click();
    await expect(titlesOf(doneSection(page))).not.toContainText(["행에서 체크"]);
    await expect(page).toHaveURL(/\?view=done$/);
    await page.goto("/dashboard?view=all");
    await expect(titlesOf(todoSection(page))).toContainText(["행에서 체크"]);
  });

  test("삭제하면 패널이 닫히고 목록에서 사라진다", async () => {
    const id = await seedTask({ title: "지울 것" });
    await openTask(id);

    await panel(page).getByRole("button", { name: "삭제" }).click();

    await expect(page).toHaveURL(/\/dashboard\?view=all$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(titlesOf(todoSection(page))).not.toContainText(["지울 것"]);
  });

  test("제목을 공백만 넣고 저장하면 알리고 아무것도 바꾸지 않는다", async () => {
    const id = await seedTask({ title: "그대로 남을 제목" });
    await openTask(id);

    const detail = panel(page);
    await detail.getByLabel("제목").fill("   ");
    await detail.getByRole("button", { name: "저장" }).click();

    await expect(detail.getByRole("alert")).toContainText("제목을 입력해 주세요.");
    const { data } = await user.client.from("tasks").select("title").eq("id", id).single();
    expect(data?.title).toBe("그대로 남을 제목");
  });

  test("태그 필터가 걸린 채로 패널을 열고 저장해도 필터가 유지된다", async () => {
    const id = await seedTask({ title: "필터 안의 태스크", tagIds: [workTagId] });
    await page.goto(`/dashboard?view=all&tag=${workTagId}`);

    await todoSection(page).getByRole("link", { name: "필터 안의 태스크 상세" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?view=all&tag=${workTagId}&task=${id}$`));

    const detail = panel(page);
    await detail.getByLabel("제목").fill("필터 안에서 고침");
    await detail.getByRole("button", { name: "저장" }).click();

    await expect(page).toHaveURL(new RegExp(`\\?view=all&tag=${workTagId}&task=${id}$`));
    await expect(titlesOf(todoSection(page))).toContainText(["필터 안에서 고침"]);

    // 닫아도 필터가 남는다.
    await detail.getByRole("link", { name: "패널 닫기" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?view=all&tag=${workTagId}$`));
  });

  test("앱 알림에서 온 딥링크로 바로 열린다", async () => {
    const id = await seedTask({ title: "딥링크 대상", tagIds: [studyTagId] });

    await page.goto(`/dashboard?task=${id}`);

    await expect(panel(page).getByLabel("제목")).toHaveValue("딥링크 대상");
  });
});
