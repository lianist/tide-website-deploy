import { expect, test, type Page } from "@playwright/test";

import { bearer, expectFailure } from "./support/api";
import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";
import { signInThroughUi } from "./support/ui";

/**
 * L-P1-07 검증 — 설정 화면과 회원 탈퇴(`SET-1`).
 *
 * 🔑 **LLM을 부르지 않는다.** 판정이 전부 DB 제약(CASCADE)과 Server Action의 이메일 비교에 있어
 * 계정과 행을 심는 것만으로 모든 갈래가 결정적이다. `L-P1-03`·`04`·`05`·`06`에 이어 다섯 루프째
 * 비용 0·흔들림 0이다.
 *
 * ⚠️ **파괴적 경로다.** 테스트는 `createSignedInUser`로 자기가 만든 계정만 지운다 — 그 헬퍼가
 * 무작위 주소(`dochi-test-<uuid>@dochi.test`)로만 계정을 만들므로 구조적으로 보장된다.
 *
 * 순서가 중요하다: 3번이 alice를 지우므로 1·2번이 먼저 끝나야 하고, 4·5·7번은 지워진 뒤를 본다.
 */
test.describe.configure({ mode: "serial" });

const ALICE_TASK = "알리스의 태스크";
const BOB_TASK = "밥의 태스크";
const SUMMARY = "설정 화면 검증용 기록.";

/** 다섯 테이블을 한 번에 센다. `profiles`만 축이 `id`이고 나머지는 `user_id`다. */
async function countAll(admin: DochiClient, userId: string): Promise<(number | null)[]> {
  const counts = await Promise.all([
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("id", userId),
    admin.from("tags").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("job_logs").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("task_tags").select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return counts.map((result) => result.count);
}

/** 가입 트리거가 `profiles` 1행과 '미분류' 1행을 만들고, 아래 시드가 나머지 셋을 채운다. */
const SEEDED = [1, 1, 1, 1, 1];

test.describe("설정과 회원 탈퇴", () => {
  let admin: DochiClient;
  /** 탈퇴할 사람. */
  let alice: TestUser;
  /** 구경꾼 — CASCADE가 남의 행까지 쓸어가지 않는지를 이 사람이 증언한다. */
  let bob: TestUser;

  /** 테스트들이 한 번 로그인한 탭을 나눠 쓴다(`history.spec.ts`와 같은 규약 — Auth 속도 제한). */
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    // 둘 다 같은 모양으로 채운다. 그래야 "alice만 0이 됐다"가 대칭 비교로 읽힌다.
    for (const [user, title] of [
      [alice, ALICE_TASK],
      [bob, BOB_TASK],
    ] as const) {
      const { data: tag, error: tagError } = await user.client
        .from("tags")
        .select("id")
        .eq("name", "미분류")
        .single();
      expect(tagError).toBeNull();

      const { data: log, error: logError } = await user.client
        .from("job_logs")
        .insert({
          user_id: user.user.id,
          source: "capture_create",
          outcome: "created",
          capture_summary: SUMMARY,
        })
        .select("id")
        .single();
      expect(logError).toBeNull();

      const { data: task, error: taskError } = await user.client
        .from("tasks")
        .insert({ user_id: user.user.id, title, source: "capture_create", job_log_id: log!.id })
        .select("id")
        .single();
      expect(taskError).toBeNull();

      const { error: linkError } = await user.client
        .from("task_tags")
        .insert({ task_id: task!.id, tag_id: tag!.id, user_id: user.user.id });
      expect(linkError).toBeNull();
    }

    expect(await countAll(admin, alice.user.id)).toEqual(SEEDED);
    expect(await countAll(admin, bob.user.id)).toEqual(SEEDED);

    page = await browser.newPage();
    await signInThroughUi(page, alice.email, alice.password);
    await page.waitForURL(/\/dashboard$/);
  });

  test.afterAll(async () => {
    // alice는 탈퇴 테스트가 지운다. 앞에서 멈췄을 경우를 대비해 한 번 더 시도한다(멱등).
    for (const user of [alice, bob]) {
      if (user) await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    }
    await page?.close();
  });

  /* ───────────────────────────── 화면과 확인 단계 ───────────────────────────── */

  test("설정이 앱 셸 안에 서고 주요 메뉴가 지금 화면을 짚는다", async () => {
    await page.goto("/settings");

    const menu = page.getByRole("navigation", { name: "주요 메뉴" });
    await expect(menu.getByRole("link", { name: "설정" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "설정", level: 1 })).toBeVisible();

    // 🔴 태그 필터는 대시보드에만 있다. `sidebar` prop을 넘기지 않은 결과가 여기서 확인된다.
    await expect(page.getByRole("navigation", { name: "태그 필터" })).toHaveCount(0);
  });

  test("1단계에는 지우는 수단이 없다", async () => {
    await page.goto("/settings");

    // 계정 구획이 이메일을 그대로 보인다 — 2단계가 "그대로 치라"고 요구하는 그 문자열이다.
    const account = page.getByRole("region", { name: "계정" });
    await expect(account.getByText(alice.email)).toBeVisible();

    await expect(page.getByRole("button", { name: "영구 삭제" })).toHaveCount(0);
    await expect(page.getByLabel("이메일")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "계정 삭제" })).toHaveAttribute(
      "href",
      "/settings?confirm=delete",
    );

    // 화면을 보기만 해서는 아무것도 지워지지 않는다.
    expect(await countAll(admin, alice.user.id)).toEqual(SEEDED);
  });

  test("이메일이 다르면 거절되고, 빈 값도 서버가 막는다", async () => {
    // 🔴 구획으로 먼저 좁힌다 — Next가 라우트 안내용 `role="alert"`를 문서에 하나 더 심는다.
    const panel = () => page.getByRole("region", { name: "회원 탈퇴" });

    await page.goto("/settings?confirm=delete");
    await page.getByLabel("이메일").fill(bob.email);
    await page.getByRole("button", { name: "영구 삭제" }).click();

    await expect(page).toHaveURL(/confirm=delete&error=email_mismatch/);
    await expect(panel().getByRole("alert")).toHaveText("이메일이 일치하지 않습니다.");
    expect(await countAll(admin, alice.user.id)).toEqual(SEEDED);

    /*
      🔴 **가드가 URL이 아니라 이메일 비교라는 것**을 여기서 증명한다. `required`를 벗기면 브라우저
      검증이 꺼지므로, 그래도 거절된다면 막은 것은 서버다. 위의 "다른 사람 주소"와 갈라 두는 이유는
      저쪽이 "사람이 틀리게 쳤다"이고 이쪽은 "폼을 우회했다"이기 때문이다.
    */
    await page.getByLabel("이메일").evaluate((el: HTMLInputElement) => el.removeAttribute("required"));
    await page.getByLabel("이메일").fill("");
    await page.getByRole("button", { name: "영구 삭제" }).click();

    await expect(page).toHaveURL(/confirm=delete&error=email_mismatch/);
    expect(await countAll(admin, alice.user.id)).toEqual(SEEDED);
  });

  /* ─────────────────────────────── 탈퇴 실행 ─────────────────────────────── */

  test("탈퇴하면 다섯 테이블이 전부 0행이 된다", async () => {
    await page.goto("/settings?confirm=delete");
    await page.getByLabel("이메일").fill(alice.email);
    await page.getByRole("button", { name: "영구 삭제" }).click();
    // 탈퇴도 signOut()을 지나므로 직접 로그아웃과 같은 표시를 단다 — 앱이 자기 토큰을 버리는 신호.
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);

    // RLS를 우회하는 관리자 클라이언트로 센다. 숨겨진 것이 아니라 없어진 것이어야 한다.
    expect(await countAll(admin, alice.user.id)).toEqual([0, 0, 0, 0, 0]);

    const { data: gone } = await admin.auth.admin.getUserById(alice.user.id);
    expect(gone.user).toBeNull();
  });

  test("세션이 사라져 보호 경로로 돌아가지 못한다", async () => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("다른 사용자의 데이터는 그대로다", async () => {
    // CASCADE가 남의 행까지 쓸어가면 그것도 버그다.
    expect(await countAll(admin, bob.user.id)).toEqual(SEEDED);

    const { data: tasks } = await admin
      .from("tasks")
      .select("title")
      .eq("user_id", bob.user.id);
    expect(tasks).toEqual([{ title: BOB_TASK }]);
  });

  test("로그인하지 않으면 설정에 닿지 못한다 — 확인 화면도 같다", async ({ browser }) => {
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();

    await guestPage.goto("/settings");
    await expect(guestPage).toHaveURL(/\/login$/);

    // 🔴 2단계도 같은 `requireUser()` 하나를 지난다. 분기가 늘면 여기가 먼저 깨진다.
    await guestPage.goto("/settings?confirm=delete");
    await expect(guestPage).toHaveURL(/\/login$/);

    await guest.close();
  });

  /* ──────────────────────────── 탈퇴 뒤의 앱 토큰 ──────────────────────────── */

  /**
   * 계약(`public/api.md` §인증)에 적는 문장을 코드가 보증한다. 서명이 아직 유효해도 토큰 주인이
   * 사라졌으면 `401`이다 — 앱은 401을 받아야만 갱신을 시도하고, 그것도 거절돼야 로그인 화면으로
   * 돌아온다. 예전에는 서명만 로컬 검증해 200이 왔고, 탈퇴한 사용자가 빠져나올 길이 없었다(HF-05).
   */
  test("탈퇴한 계정의 토큰은 401이고 갱신도 거절된다", async ({ request }) => {
    const headers = bearer(alice.accessToken);

    for (const path of ["/api/v1/me", "/api/v1/tasks", "/api/v1/job-logs"]) {
      await expectFailure(await request.get(path, { headers }), "UNAUTHORIZED", 401);
    }

    const { data } = await alice.client.auth.getSession();
    const refreshToken = data.session?.refresh_token;
    expect(refreshToken).toBeTruthy();
    const refreshed = await request.post("/auth/app/token", {
      data: { grantType: "refreshToken", refreshToken },
    });
    await expectFailure(refreshed, "UNAUTHORIZED", 401);
  });
});
