import { expect, test, type Locator, type Page } from "@playwright/test";

import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";
import { openTagFilter, signInThroughUi } from "./support/ui";

/**
 * L-P1-03 검증 — 앱 셸과 히스토리 목록(`HIST-1`의 화면 쪽).
 * L-P1-04 검증 — 교정 동선(`HIST-2`·`HIST-3`·`HIST-4`의 화면 쪽). 파일 아래쪽 §교정 동선.
 *
 * 🔑 **LLM을 부르지 않는다.** `job_logs`의 RLS가 본인 행 쓰기를 허용하므로 테스트가 로그를 직접
 * 심어 여섯 갈래(생성 성공·완료 성공·생성 실패·완료 실패·타임아웃·메일)를 **결정적으로** 그릴
 * 수 있다. 비용 0, 흔들림 0이고 `mail` 소스까지 P1에서 검증된다. 이 화면 루프의 가장 중요한
 * 설계 결정이다(`docs/ROADMAP.md` §L-P1-03).
 *
 * 시각도 전부 절대값으로 심는다 — 히스토리는 '오늘'을 판정하지 않으므로(지나간 기록이다)
 * `dashboard.spec.ts`가 감수한 자정 경계 흔들림이 여기에는 없다.
 */
test.describe.configure({ mode: "serial" });

const TZ = "Asia/Seoul";

/**
 * 2026년 9월 24일(목) KST의 어느 시각. 절대값으로 심어 '오늘'에 기대지 않는다 — 히스토리는
 * 지나간 기록을 읽는 화면이라 `dashboard.spec.ts`가 감수한 자정 경계 흔들림이 없다.
 */
const AT = (hourKst: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 24, hourKst - 9, minute)).toISOString();

const CREATED_SUMMARY = "회의록 화면. 다음 주까지 할 일 두 건이 적혀 있다.";
const COMPLETED_SUMMARY = "카카오톡에서 설문 응답을 마쳤다는 메시지.";
const COMPLETE_RATIONALE = "캡처의 '완료' 표시가 이 태스크의 제목과 같다.";
const NO_CREATE_SUMMARY = "커피 사진. 업무와 무관해 보인다.";
const NO_COMPLETE_SUMMARY = "장바구니 화면. 끝났다고 볼 태스크가 없다.";
const MAIL_SUMMARY = "메일 본문에 적힌 제출 기한.";

test.describe("앱 셸과 히스토리", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;

  /**
   * 스물세 테스트가 **한 번 로그인한 탭을 나눠 쓴다.** 테스트마다 로그인하면 Supabase Auth 요청이
   * 그만큼 늘어 속도 제한에 닿고 다른 spec까지 함께 떨어진다(`dashboard.spec.ts`와 같은 규약).
   */
  let page: Page;
  /** 남의 눈 — 빈 히스토리 문구와 "남의 기록은 보이지 않는다"를 한 탭이 함께 본다. */
  let bobPage: Page;

  let mailLogId: string;
  let createdLogId: string;
  let completedLogId: string;
  let noCreateLogId: string;
  let noCompleteLogId: string;
  let timeoutLogId: string;

  let completedTaskId: string;

  const items = () => page.locator("li[data-log-id]");
  const item = (id: string) => page.locator(`li[data-log-id="${id}"]`);
  const idsOf = (list: Locator) =>
    list.evaluateAll((els) => els.map((el) => el.getAttribute("data-log-id")));

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    // 판정 기준을 명시한다 — 가입 기본값이 바뀌어도 이 테스트의 뜻은 바뀌지 않아야 한다.
    await alice.client.from("profiles").update({ timezone: TZ }).eq("id", alice.user.id);

    // **일부러 뒤섞인 순서로** insert한다. 그대로 나오면 통과해 버리는 함정을 피한다.
    const { data: logs, error: logError } = await alice.client
      .from("job_logs")
      .insert([
        {
          user_id: alice.user.id,
          source: "capture_complete",
          outcome: "completed",
          capture_summary: COMPLETED_SUMMARY,
          rationale: COMPLETE_RATIONALE,
          created_at: AT(12),
        },
        {
          user_id: alice.user.id,
          source: "capture_create",
          outcome: "created",
          capture_summary: CREATED_SUMMARY,
          created_at: AT(13),
        },
        {
          user_id: alice.user.id,
          source: "mail",
          outcome: "created",
          capture_summary: MAIL_SUMMARY,
          created_at: AT(14),
        },
        {
          user_id: alice.user.id,
          source: "capture_create",
          outcome: "failed",
          failure_reason: "NO_TASK_TO_CREATE",
          capture_summary: NO_CREATE_SUMMARY,
          created_at: AT(11),
        },
        {
          user_id: alice.user.id,
          source: "capture_complete",
          outcome: "failed",
          failure_reason: "NO_TASK_TO_COMPLETE",
          capture_summary: NO_COMPLETE_SUMMARY,
          created_at: AT(10),
        },
        {
          // 요약이 없는 유일한 갈래 — 타임아웃과 LLM 오류다(설계 결정 17).
          user_id: alice.user.id,
          source: "capture_create",
          outcome: "failed",
          failure_reason: "AGENT_TIMEOUT",
          capture_summary: null,
          created_at: AT(9),
        },
      ])
      .select("id, source, outcome, failure_reason");
    expect(logError).toBeNull();

    const pick = (source: string, outcome: string, reason: string | null = null) =>
      logs!.find(
        (log) => log.source === source && log.outcome === outcome && log.failure_reason === reason,
      )!.id;

    mailLogId = pick("mail", "created");
    createdLogId = pick("capture_create", "created");
    completedLogId = pick("capture_complete", "completed");
    noCreateLogId = pick("capture_create", "failed", "NO_TASK_TO_CREATE");
    noCompleteLogId = pick("capture_complete", "failed", "NO_TASK_TO_COMPLETE");
    timeoutLogId = pick("capture_create", "failed", "AGENT_TIMEOUT");

    // 📮 `created_at`만 주면 `updated_at`이 `now()`가 되어 두 값이 갈라지고, 그 태스크는
    // "생성 이후 변경됨"으로 판정돼 `data-revertable`이 false가 된다(`L-P1-02`의 함정).
    const { data: tasks, error: taskError } = await alice.client
      .from("tasks")
      .insert([
        {
          user_id: alice.user.id,
          title: "회의록 정리해서 공유하기",
          status: "todo",
          source: "capture_create",
          job_log_id: createdLogId,
          created_at: AT(13),
          updated_at: AT(13),
        },
        {
          user_id: alice.user.id,
          title: "다음 주 일정 확정하기",
          status: "todo",
          source: "capture_create",
          job_log_id: createdLogId,
          // 한 캡처가 만든 태스크라도 시각을 갈라 둔다 — 같으면 정렬 타이브레이커가 `id`로
          // 넘어가(매퍼의 `localeCompare`) 순서가 실행마다 달라진다.
          created_at: AT(13, 1),
          updated_at: AT(13, 1),
        },
        {
          user_id: alice.user.id,
          title: "설문 응답 제출",
          status: "done",
          source: "manual",
          completed_by_job_log_id: completedLogId,
          created_at: AT(8),
          updated_at: AT(12),
        },
      ])
      .select("id, title");
    expect(taskError).toBeNull();
    completedTaskId = tasks!.find((task) => task.title === "설문 응답 제출")!.id;
  });

  test.afterAll(async () => {
    await page?.close();
    await bobPage?.close();
    if (alice) await admin.auth.admin.deleteUser(alice.user.id).catch(() => undefined);
    if (bob) await admin.auth.admin.deleteUser(bob.user.id).catch(() => undefined);
  });

  test.beforeEach(async ({ browser }) => {
    if (!page) {
      page = await browser.newPage();
      await signInThroughUi(page, alice.email, alice.password);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    // 앞 테스트가 남긴 쿼리를 지우고 같은 출발선으로 돌아온다.
    await page.goto("/history");
  });

  /* ─────────────────────────────── 앱 셸 ─────────────────────────────── */

  test("주요 메뉴가 보기와 화면을 잇고, 지금 화면을 짚는다", async () => {
    const menu = page.getByRole("navigation", { name: "주요 메뉴" });
    // 목업의 순서다(`L-P1-10`): 보기들 → 히스토리 → 구분선 → 설정. '확인 필요'는 건수 배지가
    // 이름에 붙는다(`L-P1-12`).
    await expect(menu.getByRole("link")).toHaveText([
      "오늘",
      "전체",
      /^확인 필요/,
      "완료",
      "히스토리",
      "설정",
    ]);
    await expect(menu.getByRole("link", { name: "히스토리" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(menu.getByRole("link", { name: "오늘" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    await menu.getByRole("link", { name: "오늘" }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "오늘" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("태그 필터는 대시보드에만 있고, 거기서도 정확히 하나다", async () => {
    // 🔴 좁은 화면용과 넓은 화면용을 따로 그리면 strict mode가 둘을 잡아 필터 검증이 전부 깨진다.
    await expect(page.getByRole("navigation", { name: "태그 필터" })).toHaveCount(0);

    // '미분류' 하나뿐이면 구획째 숨는다(`L-P1-10`) — 거를 것이 생기게 태그 하나를 심는다.
    await alice.client.from("tags").insert({ user_id: alice.user.id, name: "셸 확인용" });
    await page.goto("/dashboard");
    await openTagFilter(page);
    await expect(page.getByRole("navigation", { name: "태그 필터" })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(1);
  });

  test("사이드바의 나머지(계정·로그아웃·단축키)가 히스토리에도 그대로 있다", async () => {
    await expect(page.getByText(alice.email)).toBeVisible();
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
    await expect(page.getByRole("region", { name: "전역 단축키" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "히스토리" })).toBeVisible();
  });

  /**
   * HF-04 — 계정과 [로그아웃]이 **페이지 맨 밑**에 있어, 기록이 쌓인 히스토리에서는 스크롤을 해야
   * 보였다(사용자 보고 2026-09-26). 단축키 구획 바로 밑으로 올렸다.
   *
   * 위치를 **좌표로** 잰다 — 클래스(`lg:mt-auto`)를 보면 스타일을 바꿀 때마다 깨지고, "보인다"만
   * 보면 긴 페이지에서도 통과해 버린다(뷰포트 밖이어도 `toBeVisible`은 참이다).
   */
  test("계정과 로그아웃이 단축키 바로 밑, 첫 화면 안에 있다", async () => {
    const shortcuts = await page.getByRole("region", { name: "전역 단축키" }).boundingBox();
    const account = await page.getByRole("button", { name: "로그아웃" }).boundingBox();
    const viewport = page.viewportSize()!;

    expect(account!.y).toBeGreaterThan(shortcuts!.y);
    expect(account!.y - (shortcuts!.y + shortcuts!.height)).toBeLessThan(80);
    expect(account!.y + account!.height).toBeLessThan(viewport.height);
  });

  test("로그아웃은 아이콘만 있고 이름은 aria-label이 든다", async () => {
    const button = page.getByRole("button", { name: "로그아웃" });
    await expect(button).toBeVisible();
    // 보이는 글자가 없다 = 그만큼의 폭이 이메일로 갔다.
    await expect(button).toHaveText("");
    await expect(button.locator("svg")).toHaveCount(1);

    // HF-10 — QA 요청으로 32px → 40px 버튼, 18px → 24px 아이콘(QA가 건넨 원본 크기).
    const box = (await button.boundingBox())!;
    expect(box.width).toBe(40);
    expect(box.height).toBe(40);
    expect((await button.locator("svg").boundingBox())!.width).toBe(24);
  });

  /**
   * HF-02 — 앱 창 안에서 같은 단축키가 웹 표기와 앱 표기로 나란히 보이던 것을 맞췄다.
   * **철자가 계약이다**(앱 `HotkeyConfig.shortcutDisplay`와 같아야 한다).
   *
   * 처음 눌려 있는 쪽은 실행한 OS를 따르므로 단언하지 않는다 — 그건 아래 헤더 테스트가 본다.
   */
  test("단축키는 플랫폼을 골라 보고, 철자가 앱과 같다", async () => {
    const shortcuts = page.getByRole("region", { name: "전역 단축키" });
    await expect(shortcuts.getByRole("button", { pressed: true })).toHaveCount(1);

    await shortcuts.getByRole("button", { name: "Windows" }).click();
    await expect(shortcuts.getByText("Ctrl+Shift+1")).toBeVisible();
    await expect(shortcuts.getByText("Ctrl+Shift+2")).toBeVisible();
    await expect(shortcuts.getByText("Shift+⌘+1")).toHaveCount(0);

    await shortcuts.getByRole("button", { name: "macOS" }).click();
    await expect(shortcuts.getByText("Shift+⌘+1")).toBeVisible();
    await expect(shortcuts.getByText("Shift+⌘+2")).toBeVisible();
    await expect(shortcuts.getByText("Ctrl+Shift+1")).toHaveCount(0);

    // 한 번에 한 플랫폼만 보이므로 줄은 언제나 둘이다 — 240px 사이드바에서 라벨이 쪼개지지 않는다.
    await expect(shortcuts.getByText("새 태스크")).toHaveCount(1);
    await expect(shortcuts.getByText("완료")).toHaveCount(1);
  });

  test("처음 보여 줄 플랫폼을 요청 헤더에서 고른다", async () => {
    // 같은 컨텍스트의 쿠키로 나가므로 로그인한 요청이다. 서버가 그린 HTML을 그대로 본다.
    const mac = await page.request.get("/history", {
      headers: { "sec-ch-ua-platform": '"macOS"' },
    });
    expect(await mac.text()).toContain("Shift+⌘+1");

    const windows = await page.request.get("/history", {
      headers: { "sec-ch-ua-platform": '"Windows"' },
    });
    expect(await windows.text()).toContain("Ctrl+Shift+1");
  });

  /* ───────────────────────────── 목록 ────────────────────────────── */

  test("작업 로그가 최신순으로 그려진다", async () => {
    await expect(items()).toHaveCount(6);
    expect(await idsOf(items())).toEqual([
      mailLogId,
      createdLogId,
      completedLogId,
      noCreateLogId,
      noCompleteLogId,
      timeoutLogId,
    ]);
  });

  test("생성 성공 — 시각·소스·결과·요약이 한 항목에 모인다", async () => {
    const row = item(createdLogId);
    await expect(row).toHaveAttribute("data-source", "capture_create");
    await expect(row).toHaveAttribute("data-outcome", "created");
    // 계산 컬럼이 살아 있는지도 여기서 함께 본다 — 심은 태스크 둘이 손대지 않은 상태다.
    await expect(row).toHaveAttribute("data-revertable", "true");

    // `<time datetime>`에는 접히기 전의 순간이, 글자에는 사용자 시간대로 접힌 값이 들어간다.
    await expect(row.locator("time")).toHaveAttribute("datetime", /^2026-09-24T04:00:00/);
    await expect(row.locator("time")).toHaveText("9월 24일 (목) 13:00");

    await expect(row.getByText("캡처 (생성)")).toBeVisible();
    await expect(row.getByText("생성됨", { exact: true })).toBeVisible();
    await expect(row.getByText(CREATED_SUMMARY)).toBeVisible();
  });

  test("완료 성공 — 근거가 함께 남는다", async () => {
    const row = item(completedLogId);
    await expect(row).toHaveAttribute("data-source", "capture_complete");
    await expect(row).toHaveAttribute("data-outcome", "completed");
    await expect(row).toHaveAttribute("data-revertable", "true");

    await expect(row.getByText("캡처 (완료)")).toBeVisible();
    await expect(row.getByText("완료됨", { exact: true })).toBeVisible();
    await expect(row.getByText(COMPLETED_SUMMARY)).toBeVisible();
    // 완료 오판을 교정하려면 왜 닫았는지를 읽어야 한다(`L-P1-01`이 연 칸).
    await expect(row.getByText(COMPLETE_RATIONALE)).toBeVisible();
  });

  test("생성 실패 — 사유가 한국어 문장으로 뜬다", async () => {
    const row = item(noCreateLogId);
    await expect(row).toHaveAttribute("data-outcome", "failed");
    // 쓴 것이 없으니 되돌릴 것도 없다(`NOTHING_TO_REVERT`).
    await expect(row).toHaveAttribute("data-revertable", "false");

    await expect(row.getByText("실패", { exact: true })).toBeVisible();
    // 🔴 에러 코드를 그대로 보여 주지 않는다 — `NO_TASK_TO_CREATE`는 사용자의 말이 아니다.
    await expect(row.getByText("NO_TASK_TO_CREATE")).toHaveCount(0);
    await expect(row.getByText("생성할 태스크를 찾지 못했습니다.")).toBeVisible();
    // 실패해도 요약은 남는다(`AGT-8`) — 무엇을 보고 실패했는지가 [직접 처리]의 재료다.
    await expect(row.getByText(NO_CREATE_SUMMARY)).toBeVisible();
  });

  test("완료 실패 — 다른 사유 문장이 뜬다", async () => {
    const row = item(noCompleteLogId);
    await expect(row).toHaveAttribute("data-source", "capture_complete");
    await expect(row).toHaveAttribute("data-outcome", "failed");
    await expect(row.getByText("완료할 태스크를 찾지 못했습니다.")).toBeVisible();
    await expect(row.getByText(NO_COMPLETE_SUMMARY)).toBeVisible();
  });

  test("요약이 없는 로그에 고정 문구가 선다", async () => {
    const row = item(timeoutLogId);
    await expect(row.getByText("캡처 내용이 기록되지 않았습니다.")).toBeVisible();
    await expect(row.getByText("처리 시간이 초과되었습니다.")).toBeVisible();
  });

  test("메일 소스도 자기 라벨로 그려진다", async () => {
    const row = item(mailLogId);
    await expect(row).toHaveAttribute("data-source", "mail");
    await expect(row.getByText("메일", { exact: true })).toBeVisible();
    await expect(row.getByText(MAIL_SUMMARY)).toBeVisible();
  });

  test("관련 태스크 링크가 대시보드의 상세 패널을 연다", async () => {
    const row = item(createdLogId);
    await expect(row.getByRole("link")).toHaveText([
      "회의록 정리해서 공유하기",
      "다음 주 일정 확정하기",
    ]);

    await item(completedLogId).getByRole("link", { name: "설문 응답 제출" }).click();
    await page.waitForURL(`/dashboard?task=${completedTaskId}`);
    await expect(page.getByRole("complementary", { name: "태스크 상세" })).toBeVisible();
  });

  test("`?log=`가 그 항목을 짚는다", async () => {
    await page.goto(`/history?log=${completedLogId}`);

    await expect(item(completedLogId)).toHaveAttribute("aria-current", "page");
    await expect(page.locator("li[data-log-id][aria-current]")).toHaveCount(1);
    // 짚기만 한다 — 목록이 줄지 않는다.
    await expect(items()).toHaveCount(6);
  });

  test("모르는 `log` 값 셋은 같은 자리로 합류해 목록만 그린다", async () => {
    const bobLog = await bob.client
      .from("job_logs")
      .insert({ user_id: bob.user.id, source: "capture_create", outcome: "created" })
      .select("id")
      .single();
    expect(bobLog.error).toBeNull();

    // 없는 UUID · 남의 로그 · UUID가 아닌 값. 셋 다 "짚힌 항목 없는 같은 목록"이어야 한다 —
    // 화면이 달라지면 id를 넣어 보는 것만으로 남의 기록이 실재하는지 알아낼 수 있다.
    for (const value of [crypto.randomUUID(), bobLog.data!.id, "not-a-uuid"]) {
      await page.goto(`/history?log=${value}`);
      await expect(items()).toHaveCount(6);
      await expect(page.locator("li[data-log-id][aria-current]")).toHaveCount(0);
    }
  });

  test("남의 기록은 히스토리에 오지 않는다", async ({ browser }) => {
    bobPage = await browser.newPage();
    await signInThroughUi(bobPage, bob.email, bob.password);
    await expect(bobPage).toHaveURL(/\/dashboard$/);

    await bobPage.goto("/history");
    // 앞 테스트가 bob의 로그를 하나 심었을 수 있어 "0건"이 아니라 "앨리스의 것이 없다"를 본다.
    for (const id of [mailLogId, createdLogId, completedLogId]) {
      await expect(bobPage.locator(`li[data-log-id="${id}"]`)).toHaveCount(0);
    }
    await expect(bobPage.getByText(CREATED_SUMMARY)).toHaveCount(0);
  });

  test("로그인하지 않으면 히스토리에 닿지 못한다", async ({ browser }) => {
    const guest = await browser.newPage();
    await guest.goto("/history");
    await expect(guest).toHaveURL(/\/login/);
    await guest.close();
  });

  /* ──────────────────── 교정 동선 (L-P1-04) ──────────────────── */

  /*
    🔴 **아래 테스트들은 로그를 각자 심는다.** 위 네 테스트가 `items()).toHaveCount(6)`을 단언하므로
    공유 `beforeAll` 묶음에 로그를 더하면 그 넷이 깨진다. 공유 로그를 **되돌려서도** 안 된다 —
    직렬 실행이라 뒤 테스트의 관련 태스크가 사라진다. 그래서 되돌리기는 늘 새 로그에만 한다.

    여기서도 LLM을 부르지 않는다. 되돌리기는 DB 함수가 전부 하므로 심은 로그로 네 갈래
    (되돌릴 수 있음 · 수정됨 · 이미 되돌림 · 되돌릴 것 없음)를 결정적으로 만들 수 있다.
  */

  /** 되돌리기 검증용 로그 한 건 + 그에 딸린 태스크. */
  const seedLog = async (input: {
    outcome: "created" | "completed";
    at: string;
    tasks: { title: string; status: "todo" | "done"; at: string; updatedAt?: string }[];
  }) => {
    const created = input.outcome === "created";

    const { data: log, error } = await alice.client
      .from("job_logs")
      .insert({
        user_id: alice.user.id,
        source: created ? "capture_create" : "capture_complete",
        outcome: input.outcome,
        capture_summary: "되돌리기 검증용 캡처.",
        created_at: input.at,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const logId = log!.id;

    const { data: tasks, error: taskError } = await alice.client
      .from("tasks")
      .insert(
        // 📮 두 연결 칸을 **늘 함께** 적는다. 배열 insert는 행들의 칸 집합을 통일하므로 한 행만
        // 칸을 비우면 기본값이 아니라 `null`이 들어간다(`L-P1-01`의 함정).
        input.tasks.map((task) => ({
          user_id: alice.user.id,
          title: task.title,
          status: task.status,
          source: created ? ("capture_create" as const) : ("manual" as const),
          job_log_id: created ? logId : null,
          completed_by_job_log_id: created ? null : logId,
          created_at: task.at,
          // 📮 `created_at`만 주면 `updated_at`이 `now()`가 되어 "수정됨"으로 판정된다(`L-P1-02`).
          updated_at: task.updatedAt ?? task.at,
        })),
      )
      .select("id, title");
    expect(taskError).toBeNull();

    return { logId, titles: tasks!.map((task) => task.title) };
  };

  const panel = () => page.getByRole("complementary", { name: "태스크 상세" });
  const revertButton = (id: string) => item(id).getByRole("button", { name: "되돌리기" });
  const handleLink = (id: string) => item(id).getByRole("link", { name: "직접 처리" });

  test("생성 실패의 [직접 처리]가 요약이 채워진 새 태스크 패널을 연다", async () => {
    await handleLink(noCreateLogId).click();

    await page.waitForURL(`/dashboard?new=1&from=${noCreateLogId}`);
    // 요약 문장 자체는 주소에 실리지 않는다 — 서버가 로그를 읽어 채운다.
    await expect(page).not.toHaveURL(/커피/);
    await expect(panel().getByRole("heading", { name: "새 태스크" })).toBeVisible();
    await expect(panel().getByLabel("제목")).toHaveValue(NO_CREATE_SUMMARY);
  });

  test("요약이 없는 실패는 빈 폼으로 간다", async () => {
    await handleLink(timeoutLogId).click();

    await page.waitForURL(`/dashboard?new=1&from=${timeoutLogId}`);
    // 요약이 없는 갈래(타임아웃)라 채울 것이 없다. 고정 문구를 제목에 넣지 않는다.
    await expect(panel().getByLabel("제목")).toHaveValue("");
  });

  test("완료 실패의 [직접 처리]는 미완료 목록으로만 간다", async () => {
    await handleLink(noCompleteLogId).click();

    // 완료할 것을 사용자가 골라야 하므로 패널을 열지 않는다.
    // 미완료 목록 전부가 '전체' 보기다(`L-P1-10`). 기본 화면('오늘')으로 가면 골라야 할 태스크가 빠진다.
    await page.waitForURL("/dashboard?view=all");
    await expect(panel()).toHaveCount(0);
  });

  test("중복 실패도 사유 문장이 뜨고, [직접 처리]가 새 태스크로 이어받는다", async () => {
    // `AGT-11` — "같은 일이 아니다"라고 보면 사용자가 여기서 새로 만든다. 이 테스트 안에서만 심는다 —
    // beforeAll에 두면 앞의 정렬·개수 단언에 끼어든다.
    const summary = "관리비 고지서 문자.";
    const { data: log, error } = await alice.client
      .from("job_logs")
      .insert({
        user_id: alice.user.id,
        source: "capture_create",
        outcome: "failed",
        failure_reason: "DUPLICATE_TASK",
        capture_summary: summary,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    await page.goto("/history");

    const row = item(log!.id);
    await expect(row).toHaveAttribute("data-outcome", "failed");
    await expect(row.getByText("DUPLICATE_TASK")).toHaveCount(0);
    await expect(row.getByText("이미 있는 태스크와 같은 일이라 만들지 않았습니다.")).toBeVisible();

    await handleLink(log!.id).click();
    await page.waitForURL(`/dashboard?new=1&from=${log!.id}`);
    await expect(panel().getByLabel("제목")).toHaveValue(summary);
  });

  test("생성 되돌리기가 그 태스크들을 지운다", async () => {
    const { logId } = await seedLog({
      outcome: "created",
      at: AT(20),
      tasks: [
        { title: "되돌릴 태스크 하나", status: "todo", at: AT(20) },
        { title: "되돌릴 태스크 둘", status: "todo", at: AT(20, 1) },
      ],
    });

    await page.goto("/history");
    await expect(item(logId)).toHaveAttribute("data-revertable", "true");
    await revertButton(logId).click();

    // 목록이 다시 그려지고 그 기록은 더 이상 되돌릴 수 없다 — 가리키는 태스크가 사라졌다.
    await expect(item(logId)).toHaveAttribute("data-revertable", "false");
    await expect(revertButton(logId)).toHaveCount(0);
    // 기록 자체는 남는다. 되돌리기는 작업 로그를 지우는 일이 아니다.
    await expect(item(logId)).toHaveCount(1);

    await page.goto("/dashboard?view=all");
    await expect(page.getByRole("heading", { name: "되돌릴 태스크 하나" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "되돌릴 태스크 둘" })).toHaveCount(0);
  });

  test("완료 되돌리기가 그 태스크를 할 일로 돌려놓는다", async () => {
    const { logId } = await seedLog({
      outcome: "completed",
      at: AT(21),
      // 완료 캡처가 `status`를 쓴 것이라 두 시각이 갈라져 있다 — 그래도 되돌릴 수 있어야 한다.
      tasks: [{ title: "되돌릴 완료 태스크", status: "done", at: AT(8), updatedAt: AT(21) }],
    });

    await page.goto("/history");
    await revertButton(logId).click();
    await expect(item(logId)).toHaveAttribute("data-revertable", "false");

    // 미완료 전부는 '전체' 보기다(`L-P1-10`). 완료 목록은 이제 다른 보기라 같은 화면에 없다.
    await page.goto("/dashboard?view=all");
    const todo = page.getByRole("region", { name: "할 일" });
    await expect(todo.getByRole("heading", { name: "되돌릴 완료 태스크" })).toBeVisible();
    await page.goto("/dashboard?view=done");
    await expect(
      page.getByRole("region", { name: "완료" }).getByRole("heading", { name: "되돌릴 완료 태스크" }),
    ).toHaveCount(0);
  });

  test("이미 되돌린 완료 기록에는 [되돌리기]가 없다", async () => {
    // 가리키는 태스크가 이미 `todo`인 완료 로그 = `ALREADY_REVERTED`.
    const { logId } = await seedLog({
      outcome: "completed",
      at: AT(22),
      tasks: [{ title: "이미 할 일로 돌아온 태스크", status: "todo", at: AT(22) }],
    });

    await page.goto("/history");
    await expect(item(logId)).toHaveAttribute("data-revertable", "false");
    // 🔑 버튼의 존재로 되돌리기 가능 여부를 유추하지 않는다 — 마크업이 먼저 말하고 버튼이 따른다.
    await expect(revertButton(logId)).toHaveCount(0);
  });

  test("수정된 태스크는 거절되고 사유가 그 기록 안에 뜬다", async () => {
    const { logId } = await seedLog({
      outcome: "created",
      at: AT(23),
      tasks: [
        // 하나만 손댔는데도 셋 다 남는다 — 생성 되돌리기는 all-or-nothing이다.
        { title: "손댄 태스크", status: "todo", at: AT(23), updatedAt: AT(23, 30) },
        { title: "손대지 않은 태스크", status: "todo", at: AT(23, 1) },
      ],
    });

    await page.goto("/history");
    // `revertable`은 **판정을 미리 비춘다** — 눌러 보기 전에 이미 false다.
    await expect(item(logId)).toHaveAttribute("data-revertable", "false");

    // 버튼이 없으므로 화면에서는 닿을 수 없는 경로다. 액션이 실제로 거절하는지를 주소로 확인한다.
    await page.goto(`/history?log=${logId}`);
    await expect(item(logId)).toHaveAttribute("aria-current", "page");

    // 거절 문구는 **그 기록 안에** 선다(사용자 결정) — 상단 배너는 어느 것이 거절됐는지 못 말한다.
    await page.goto(`/history?log=${logId}&error=TASK_MODIFIED`);
    await expect(item(logId).getByRole("alert")).toHaveText(
      "생성 이후 태스크가 변경되어 되돌릴 수 없습니다.",
    );
    // 🔴 에러 코드를 그대로 보여 주지 않는다.
    await expect(page.getByText("TASK_MODIFIED")).toHaveCount(0);

    // 태스크는 한 건도 사라지지 않았다. 마감이 없는 태스크라 '전체' 보기에서 본다(`L-P1-10`).
    await page.goto("/dashboard?view=all");
    await expect(page.getByRole("heading", { name: "손댄 태스크" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "손대지 않은 태스크" })).toBeVisible();
  });

  test("실패 기록에는 [되돌리기]가 없고 [직접 처리]만 있다", async () => {
    // 쓴 것이 없으니 되돌릴 것도 없다(`NOTHING_TO_REVERT`).
    await expect(item(noCreateLogId)).toHaveAttribute("data-revertable", "false");
    await expect(revertButton(noCreateLogId)).toHaveCount(0);
    await expect(handleLink(noCreateLogId)).toBeVisible();

    // 거꾸로, 성공 기록에는 [직접 처리]가 없다 — 이어받을 실패가 아니다.
    await expect(handleLink(createdLogId)).toHaveCount(0);
    await expect(revertButton(createdLogId)).toBeVisible();
  });
});

/**
 * 빈 히스토리는 로그가 하나도 없는 계정으로만 볼 수 있다. 위 describe의 bob은 딥링크 테스트가
 * 로그를 하나 심어 두므로 여기서 계정을 따로 연다 — 순서에 기대지 않기 위해서다.
 */
test.describe("빈 히스토리", () => {
  test("기록이 없으면 다음 행동을 알려 준다", async ({ page }) => {
    const admin = createAdminClient();
    const fresh = await createSignedInUser(admin);

    try {
      await signInThroughUi(page, fresh.email, fresh.password);
      await expect(page).toHaveURL(/\/dashboard$/);

      await page.goto("/history");
      await expect(page.locator("li[data-log-id]")).toHaveCount(0);
      await expect(
        page.getByText("아직 기록이 없습니다. 앱에서 화면을 캡처하면 여기에 쌓입니다."),
      ).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(fresh.user.id).catch(() => undefined);
    }
  });
});
