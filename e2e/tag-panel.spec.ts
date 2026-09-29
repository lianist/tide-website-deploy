import { expect, test, type Page } from "@playwright/test";

import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";
import { openTagFilter, signInThroughUi } from "./support/ui";

/**
 * L-P1-06 검증 — 태그 관리 패널(`DASH-6`의 화면 쪽).
 *
 * `task-panel.spec.ts`와 같은 규약이다: 직렬 실행 + **파일당 로그인 1회**(Supabase Auth 속도 제한).
 *
 * **LLM을 한 번도 부르지 않는다.** 판정이 전부 DB 함수와 라우트에 있어 태그·태스크를 심는 것만으로
 * 모든 갈래가 결정적이다. `L-P1-03`·`04`·`05`에 이어 네 루프째 비용 0이다.
 *
 * **테스트마다 자기 태그를 새로 심는다.** 병합·삭제가 파괴적이라 시드를 돌려 쓰면 앞 테스트가
 * 뒤 테스트의 전제를 지운다(`tags.spec.ts` §태그 병합이 같은 이유로 그렇게 한다).
 */
test.describe.configure({ mode: "serial" });

test.describe("태그 관리 패널", () => {
  let admin: DochiClient;
  let user: TestUser;
  let page: Page;

  const panel = () => page.getByRole("complementary", { name: "태그 관리" });
  const filterNav = () => page.getByRole("navigation", { name: "태그 필터" });
  /** 행은 이름이 아니라 **id**로 집는다 — `hasText: "업무"`는 "업무팀" 행까지 잡는다. */
  const row = (id: string) => panel().locator(`li[data-tag-id="${id}"]`);

  /** 태그 하나. 이름을 돌려받아 `aria-label`(`"<이름> 이름"`)을 만들 수 있게 한다. */
  async function seedTag(name: string): Promise<{ id: string; name: string }> {
    const { data, error } = await user.client
      .from("tags")
      .insert({ user_id: user.user.id, name })
      .select("id, name")
      .single();
    if (error) throw error;
    return data;
  }

  async function seedTask(title: string, tagIds: string[]): Promise<string> {
    const { data, error } = await user.client
      .from("tasks")
      .insert({ user_id: user.user.id, title, source: "manual" })
      .select("id")
      .single();
    if (error) throw error;
    for (const tagId of tagIds) {
      const linked = await user.client
        .from("task_tags")
        .insert({ task_id: data.id, tag_id: tagId, user_id: user.user.id });
      if (linked.error) throw linked.error;
    }
    return data.id;
  }

  const tagNames = async (): Promise<string[]> => {
    const { data, error } = await user.client.from("tags").select("name").order("name");
    if (error) throw error;
    return data.map((tag) => tag.name);
  };

  const uncategorizedId = async (): Promise<string> => {
    const { data, error } = await user.client.from("tags").select("id").eq("name", "미분류").single();
    if (error) throw error;
    return data.id;
  };

  test.beforeAll(async () => {
    admin = createAdminClient();
    user = await createSignedInUser(admin);
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
    await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
  });

  test("사이드바 [관리]가 패널을 열고, 태그 필터를 그대로 나른다", async () => {
    const tag = await seedTag("진입 확인용");

    await page.goto(`/dashboard?tag=${tag.id}`);
    await page.getByRole("link", { name: "관리", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`\\?tag=${tag.id}&tags=1$`));
    await expect(panel()).toBeVisible();

    // 🔴 머리줄이 `<nav>` 바깥이라 태그 필터 네비는 여전히 화면에 정확히 하나다.
    await expect(filterNav()).toHaveCount(1);
    // 필터는 조작 내내 따라다닌다 — 패널을 열어도 고른 태그가 그대로 짚혀 있다.
    await expect(filterNav().getByRole("link", { name: tag.name })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("태그 구획은 접혀 있고 머리줄을 눌러야 펼쳐진다 — 태그를 골랐으면 펼쳐진 채로 온다 (HF-12)", async () => {
    const tag = await seedTag("접기 확인용");

    await page.goto("/dashboard");
    // 접혀 있어도 [관리]는 보인다 — `<summary>` 밖에 겹쳐 둔 이유다.
    await expect(filterNav()).toBeHidden();
    await expect(page.getByRole("link", { name: "관리", exact: true })).toBeVisible();

    await page.locator("summary", { hasText: "태그" }).click();
    await expect(filterNav().getByRole("link", { name: tag.name })).toBeVisible();

    await filterNav().getByRole("link", { name: tag.name }).click();
    await expect(page).toHaveURL(new RegExp(`\\?tag=${tag.id}$`));
    await page.reload();
    await expect(filterNav().getByRole("link", { name: tag.name })).toHaveAttribute("aria-current", "page");
  });

  test("패널 슬롯은 하나다 — `tags`가 `new`·`task`를 이긴다", async () => {
    const taskId = await seedTask("슬롯 경쟁 태스크", []);

    await page.goto(`/dashboard?tags=1&new=1&task=${taskId}`);

    await expect(panel()).toHaveCount(1);
    // 태스크 상세도 새 태스크도 서지 않는다. 셋이 실려 와도 열리는 것은 하나다.
    await expect(page.getByRole("complementary", { name: "태스크 상세" })).toHaveCount(0);
  });

  test("이름을 바꾸면 패널·사이드바 필터·태스크 행의 태그가 함께 바뀐다", async () => {
    const tag = await seedTag("옛 이름");
    await seedTask("이름 변경을 볼 태스크", [tag.id]);

    // 태스크 행을 보려고 '전체' 보기에서 연다 — 시드한 태스크에 마감이 없다(`L-P1-10`).
    await page.goto("/dashboard?view=all&tags=1");
    await row(tag.id).getByLabel(`${tag.name} 이름`, { exact: true }).fill("새 이름");
    await row(tag.id).getByRole("button", { name: "저장" }).click();

    // 주소가 그대로다 — `refresh()`가 없으면 여기서 옛 이름이 남는다. 보기도 풀리지 않는다.
    await expect(page).toHaveURL(/\?view=all&tags=1$/);
    await expect(row(tag.id).getByLabel("새 이름 이름", { exact: true })).toBeVisible();
    await openTagFilter(page);
    await expect(filterNav().getByRole("link", { name: "새 이름" })).toBeVisible();
    await expect(filterNav().getByRole("link", { name: "옛 이름" })).toHaveCount(0);
    // 목록의 태스크 행에 달린 칩도 같은 스냅샷에서 나온다.
    await expect(page.getByRole("region", { name: "할 일" })).toContainText("새 이름");
  });

  test("겹치는 이름으로 바꾸면 거절 문구가 패널 안에 서고 이름은 그대로다", async () => {
    const taken = await seedTag("이미 있는 이름");
    const tag = await seedTag("바꾸려는 태그");

    await page.goto("/dashboard?tags=1");
    await row(tag.id).getByLabel(`${tag.name} 이름`, { exact: true }).fill(taken.name);
    await row(tag.id).getByRole("button", { name: "저장" }).click();

    await expect(page).toHaveURL(/\?tags=1&error=TAG_NAME_TAKEN$/);
    // 🔴 `tags=1`이 함께 실렸으므로 패널이 살아 있고 문구가 설 자리가 있다.
    await expect(panel().getByRole("alert")).toHaveText("같은 이름의 태그가 이미 있습니다.");

    expect(await tagNames()).toContain(tag.name);
  });

  test("'미분류'는 이름 변경·삭제 폼이 없고 '기존 태그'에도 없다 — '바꿀 태그'에는 있다", async () => {
    await seedTag("바꿀 수 있는 태그");
    const protectedId = await uncategorizedId();

    await page.goto("/dashboard?tags=1");

    const uncategorized = row(protectedId);
    await expect(uncategorized).toHaveText("미분류");
    await expect(uncategorized.getByRole("textbox")).toHaveCount(0);
    await expect(uncategorized.getByRole("button")).toHaveCount(0);

    // 보호는 **출발에만** 걸린다(계약 §태그 합치기). 대칭이 아닌 것이 의도다.
    await expect(panel().getByLabel("기존 태그", { exact: true }).getByRole("option", { name: "미분류" })).toHaveCount(0);
    await expect(panel().getByLabel("바꿀 태그", { exact: true }).getByRole("option", { name: "미분류" })).toHaveCount(1);
  });

  test("바꾸면 태스크가 도착 태그로 옮겨지고, 보던 필터는 도착을 따라간다", async () => {
    const source = await seedTag("사라질 태그");
    const target = await seedTag("도착 태그");
    const taskId = await seedTask("따라갈 태스크", [source.id]);

    // 출발 태그로 필터를 건 채로 바꾼다 — 바꾸고 나면 이 필터가 가리킬 태그가 사라진다.
    await page.goto(`/dashboard?view=all&tag=${source.id}&tags=1`);
    await panel().getByLabel("기존 태그", { exact: true }).selectOption(source.id);
    await panel().getByLabel("바꿀 태그", { exact: true }).selectOption(target.id);
    await panel().getByRole("button", { name: "바꾸기" }).click();

    // 필터를 푸는 게 아니라 **도착으로 따라간다** — 보던 태스크들이 그 자리에 그대로 있다.
    await expect(page).toHaveURL(new RegExp(`\\?view=all&tag=${target.id}&tags=1$`));
    await expect(filterNav().getByRole("link", { name: source.name })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "할 일" })).toContainText("따라갈 태스크");

    const { data } = await user.client.from("task_tags").select("tag_id").eq("task_id", taskId);
    expect(data).toEqual([{ tag_id: target.id }]);
  });

  test("지우면 태그만 사라지고 태스크는 남으며, 그 태그를 보고 있었으면 필터가 풀린다", async () => {
    const tag = await seedTag("지울 태그");
    const taskId = await seedTask("살아남을 태스크", [tag.id]);

    await page.goto(`/dashboard?tag=${tag.id}&tags=1`);
    await row(tag.id).getByRole("button", { name: "삭제" }).click();

    await expect(page).toHaveURL(/\?tags=1$/);
    await openTagFilter(page);
    await expect(filterNav().getByRole("link", { name: "전체" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(await tagNames()).not.toContain(tag.name);
    const { data } = await user.client.from("tasks").select("id").eq("id", taskId);
    expect(data).toHaveLength(1);
  });

  test("같은 태그 둘을 고른 병합은 거절되고 아무것도 바뀌지 않는다", async () => {
    const tag = await seedTag("혼자 합쳐질 태그");
    const before = await tagNames();

    await page.goto("/dashboard?tags=1");
    await panel().getByLabel("기존 태그", { exact: true }).selectOption(tag.id);
    await panel().getByLabel("바꿀 태그", { exact: true }).selectOption(tag.id);
    await panel().getByRole("button", { name: "바꾸기" }).click();

    await expect(page).toHaveURL(/\?tags=1&error=TAG_MERGE_SAME$/);
    await expect(panel().getByRole("alert")).toHaveText("서로 다른 두 태그를 골라 주세요.");

    expect(await tagNames()).toEqual(before);
  });
});
