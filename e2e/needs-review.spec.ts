import { expect, test, type Page } from "@playwright/test";

import { countNeedsReview, listNeedsReview, markLogHandled, toJobLogPayload } from "@/lib/api/job-logs";

import { bearer, dataOf } from "./support/api";
import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";
import { signInThroughUi } from "./support/ui";

/**
 * L-P1-11 검증 — 확인 필요 토대(`DASH-11`의 서버 쪽).
 *
 * **LLM을 부르지 않는다.** 실패 로그를 직접 심어 범위(무엇이 들고 무엇이 안 드나)를 결정적으로
 * 그린다. 세고 읽는 함수(`countNeedsReview`·`listNeedsReview`)와 처리 표시(`markLogHandled`)는
 * 화면이 `L-P1-12`에서 서므로 **소스를 직접 부른다** — 그래서 이 스펙은 배포본 대상 실행
 * (`test:deployed`)에서 빠져야 한다(`playwright.config.ts`의 `LOCAL_ONLY_SPECS`, 설계 결정 22).
 *
 * [넘기기](`skipLog`)는 `markLogHandled`를 부르고 돌아가는 것이 전부라 여기서는 그 함수를 본다.
 * 버튼째 누르는 검증은 버튼이 생기는 `L-P1-12`의 몫이다.
 */
test.describe.configure({ mode: "serial" });

const JOB_LOGS = "/api/v1/job-logs";

type Seed = {
  source: "capture_create" | "capture_complete";
  outcome: "created" | "completed" | "failed";
  failure_reason: string | null;
  capture_summary: string | null;
  created_at: string;
};

/** 2026-09-24의 어느 시각(UTC). 시각을 갈라 심어 최신순 단언이 실행마다 흔들리지 않게 한다. */
const AT = (hour: number) => new Date(Date.UTC(2026, 8, 24, hour)).toISOString();

test.describe("확인 필요 토대", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;
  let page: Page;

  /** 범위 안 셋 — 시각 순서대로. */
  let noTaskId: string;
  let timeoutId: string;
  let internalId: string;
  /** 범위 밖 넷. */
  let outIds: string[];

  const as = (user: TestUser) => ({ headers: bearer(user.accessToken) });

  async function seed(user: TestUser, rows: Seed[]): Promise<string[]> {
    // 📮 배열 insert — 모든 행이 같은 칸 집합을 갖는다(`e2e/support/supabase.ts` 함정 1).
    const { data, error } = await user.client
      .from("job_logs")
      .insert(rows.map((row) => ({ user_id: user.user.id, ...row })))
      .select("id, created_at");
    expect(error).toBeNull();
    // 돌려받는 순서를 믿지 않고 시각으로 되짚는다.
    // PostgREST는 `+00:00` 꼴로 돌려주므로 문자열이 아니라 시각으로 비교한다.
    const at = (value: string) => Date.parse(value);
    return rows.map((row) => data!.find((got) => at(got.created_at) === at(row.created_at))!.id);
  }

  const failedCreate = (reason: string, hour: number, summary: string | null = `실패 ${reason}`): Seed => ({
    source: "capture_create",
    outcome: "failed",
    failure_reason: reason,
    capture_summary: summary,
    created_at: AT(hour),
  });

  async function handledAtOf(user: TestUser, id: string): Promise<string | null | undefined> {
    const { data } = await user.client.from("job_logs").select("handled_at").eq("id", id).maybeSingle();
    return data?.handled_at;
  }

  test.beforeAll(async ({ browser }) => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    const inScope = await seed(alice, [
      failedCreate("NO_TASK_TO_CREATE", 1, "커피 사진. 업무와 무관해 보인다."),
      // 타임아웃과 내부 오류는 요약이 없다(설계 결정 17) — 그래도 확인 필요에 든다.
      failedCreate("AGENT_TIMEOUT", 2, null),
      failedCreate("INTERNAL_ERROR", 3, null),
    ]);
    [noTaskId, timeoutId, internalId] = inScope as [string, string, string];

    outIds = await seed(alice, [
      // 이미 같은 일의 태스크가 있다 — 알림이 그 제목을 말했다.
      failedCreate("DUPLICATE_TASK", 4),
      // 완료 캡처의 실패는 "생성 실패"가 아니다.
      {
        source: "capture_complete",
        outcome: "failed",
        failure_reason: "NO_TASK_TO_COMPLETE",
        capture_summary: "끝낼 것이 없는 화면.",
        created_at: AT(5),
      },
      {
        source: "capture_complete",
        outcome: "failed",
        failure_reason: "AGENT_TIMEOUT",
        capture_summary: null,
        created_at: AT(6),
      },
      // 성공한 생성.
      {
        source: "capture_create",
        outcome: "created",
        failure_reason: null,
        capture_summary: "할 일 두 건.",
        created_at: AT(7),
      },
    ]);

    page = await browser.newPage();
    await signInThroughUi(page, alice.email, alice.password);
    await page.waitForURL("/dashboard");
  });

  test.afterAll(async () => {
    await page?.close();
    for (const user of [alice, bob]) {
      if (user) await deleteUser(admin, user.user.id);
    }
  });

  test("생성 실패 세 사유만 담기고, 중복·완료 실패·성공은 빠진다", async () => {
    expect(await countNeedsReview(alice.client)).toBe(3);

    const { data, error } = await listNeedsReview(alice.client);
    expect(error).toBeNull();
    // 최신순.
    expect(data!.map((row) => row.id)).toEqual([internalId, timeoutId, noTaskId]);
    for (const id of outIds) expect(data!.map((row) => row.id)).not.toContain(id);
  });

  test("목록 행이 히스토리와 같은 모양이다", async ({ request }) => {
    const { data } = await listNeedsReview(alice.client);
    const history = await dataOf<Record<string, unknown>[]>(await request.get(JOB_LOGS, as(alice)));
    const same = history.find((log) => log.id === noTaskId)!;

    // `JOB_LOG_SELECT`·`toJobLogPayload`를 지나므로 화면이 히스토리 항목의 재료를 그대로 쓸 수 있다.
    expect(toJobLogPayload(data!.find((row) => row.id === noTaskId)!)).toEqual(same);
  });

  test("남의 확인 필요는 세지도 읽히지도 않는다", async () => {
    expect(await countNeedsReview(bob.client)).toBe(0);
    const { data } = await listNeedsReview(bob.client);
    expect(data).toEqual([]);
  });

  test("남의 로그는 처리할 수 없다 — 오류 없이 0행이고 그대로 남는다", async () => {
    await markLogHandled(bob.client, noTaskId);

    expect(await handledAtOf(alice, noTaskId)).toBeNull();
    expect(await countNeedsReview(alice.client)).toBe(3);
  });

  test("[넘기기] — 처리하면 빠지고, 히스토리에는 handledAt과 함께 남는다", async ({ request }) => {
    const before = Date.now();
    await markLogHandled(alice.client, internalId);

    expect(await countNeedsReview(alice.client)).toBe(2);
    const { data } = await listNeedsReview(alice.client);
    expect(data!.map((row) => row.id)).toEqual([timeoutId, noTaskId]);

    // 지우지 않는다 — `GET /api/v1/job-logs`에 그대로 있고 처리 시각이 실린다.
    const history = await dataOf<{ id: string; handledAt: string | null }[]>(
      await request.get(JOB_LOGS, as(alice)),
    );
    const log = history.find((item) => item.id === internalId)!;
    expect(log).toBeDefined();
    expect(Date.parse(log.handledAt!)).toBeGreaterThanOrEqual(before - 60_000);
    // 처리하지 않은 로그와 범위 밖 로그는 null이다.
    for (const id of [timeoutId, noTaskId, ...outIds]) {
      expect(history.find((item) => item.id === id)!.handledAt).toBeNull();
    }
  });

  test("두 번 처리해도 처음 시각이 남는다", async () => {
    const first = await handledAtOf(alice, internalId);
    await markLogHandled(alice.client, internalId);
    expect(await handledAtOf(alice, internalId)).toBe(first);
  });

  /* ──────────────────── [직접 처리] — 저장했을 때만 ──────────────────── */

  const panel = () => page.getByRole("complementary", { name: "태스크 상세" });

  test("[직접 처리] 패널을 열고 닫기만 하면 남는다", async () => {
    await page.goto(`/dashboard?new=1&from=${noTaskId}`);
    await expect(panel().getByLabel("제목")).toHaveValue("커피 사진. 업무와 무관해 보인다.");
    await panel().getByRole("link", { name: "패널 닫기" }).click();
    await page.waitForURL("/dashboard");

    expect(await handledAtOf(alice, noTaskId)).toBeNull();
    expect(await countNeedsReview(alice.client)).toBe(2);
  });

  test("[직접 처리] 저장이 거절되면 남는다", async () => {
    // 요약이 없는 타임아웃 — 제목이 빈 채로 [추가]를 누르면 `title_required`로 돌아온다.
    await page.goto(`/dashboard?new=1&from=${timeoutId}`);
    await expect(panel().getByLabel("제목")).toHaveValue("");
    // `required`를 피해 서버 검증까지 보낸다 — 공백만 넣는다.
    await panel().getByLabel("제목").fill("   ");
    await panel().getByRole("button", { name: "추가" }).click();
    await page.waitForURL(/error=title_required/);

    expect(await handledAtOf(alice, timeoutId)).toBeNull();
  });

  test("[직접 처리]로 태스크를 저장하면 빠진다", async () => {
    await page.goto(`/dashboard?new=1&from=${timeoutId}`);
    await panel().getByLabel("제목").fill("타임아웃 난 캡처를 손으로 옮김");
    await panel().getByRole("button", { name: "추가" }).click();
    await page.waitForURL(/\/dashboard\?task=/);

    expect(await handledAtOf(alice, timeoutId)).not.toBeNull();
    expect(await countNeedsReview(alice.client)).toBe(1);
    const { data } = await listNeedsReview(alice.client);
    expect(data!.map((row) => row.id)).toEqual([noTaskId]);
  });
});
