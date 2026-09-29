import { expect, test } from "@playwright/test";

import { toDueAt } from "@/lib/time";

import { readCaptureImage, seedTags } from "./grade/support";
import { bearer, dataOf, type CaptureData } from "./support/api";
import {
  createAdminClient,
  createPublicClient,
  deleteUserByEmail,
  newTestEmail,
  type TestUser,
} from "./support/supabase";
import { acceptConsentThroughUi, plantProbe, readProbe } from "./support/ui";

/**
 * L-P0-14 검증 — **P0 전 구간이 한 번에 이어지는지** 본다.
 *
 * 다른 스펙들은 각자 한 층을 본다(계약·에이전트·화면·실시간). 이 스펙만 층을 가로질러, 제품이
 * 약속한 문장 하나를 통째로 증명한다 — *캡처 한 장이 태스크가 되어 화면에 뜨고, 다른 캡처 한
 * 장이 그것을 닫는다.* 사람이 겪는 순서 그대로 한 테스트 안에서 돈다.
 *
 * 배포 환경을 향해서도 같은 것을 돌린다(`PLAYWRIGHT_BASE_URL=https://… npm run test:deployed`).
 * 이 스펙은 HTTP와 브라우저로만 앱을 만지므로 대상이 로컬이든 배포본이든 의미가 같다.
 *
 * **비용과 흔들림, 둘 다 알고 받아들인다.**
 * - 실제 LLM을 2회 부른다(≈ $0.002). `agent-*.spec.ts`가 이미 `npm run test`에서 실호출을 한다.
 * - 캡처의 지연 꼬리가 p90 8~9초, 가끔 18초다(L-P0-08·L-P0-10 실측). 10초 예산을 넘기면
 *   `AGENT_TIMEOUT`이라 여정이 통째로 실패한다. 그래서 이 파일에만 재시도를 허용한다 — 결함을
 *   가리려는 것이 아니라 **이미 문서에 적힌 한계**를 테스트 쪽에서 받아들이는 것이다. 재시도가
 *   매번 필요해지면 그건 새 사실이므로 ROADMAP에 적을 것.
 */
test.describe.configure({ mode: "serial", retries: 2 });

const CAPTURES = "/api/v1/captures";
const TZ = "Asia/Seoul";
const PASSWORD = "dochi-test-1234";

/** 이 두 장이 짝이다 — `complete/01-single-candidate/expected.json`의 note가 여기 쓰라고 지목한다. */
const CREATE_FIXTURE = {
  folder: "e2e/fixtures/captures/create/05-relative-date",
  image: "02-kakao-survey-next-monday.png",
  // 화면에 '다음 주 월요일'과 '09. 21.'이 함께 적힌 캡처다. capturedAt이 정답의 일부라 고정한다.
  capturedAt: "2026-09-19T21:00:00+09:00",
};
const COMPLETE_FIXTURE = {
  folder: "e2e/fixtures/captures/complete/01-single-candidate",
  image: "01-kakao-survey-done.png",
  capturedAt: "2026-09-21T00:50:00+09:00",
};

/**
 * 완료 캡처가 **내용으로** 고르는지 보려고 심는 방해 태스크.
 *
 * `complete/01-single-candidate`의 `seedTasks`에서 설문 건(캡처가 직접 만든다)을 뺀 둘이다.
 * 첫째가 설문 태스크와 같은 날(9/21) 마감이라, 마감일만 보고 고르면 틀린다(`AGT-6`).
 */
const DISTRACTORS = [
  { title: "교양 발표 PPT 검토", dueAt: "2026-09-21" },
  { title: "고대신문 수습기자 지원서 제출", dueAt: "2026-09-22" },
];

async function imagePart(fixture: { folder: string; image: string }) {
  const { bytes, mimeType } = await readCaptureImage(fixture.folder, fixture.image);
  return { name: fixture.image, mimeType, buffer: bytes };
}

test("캡처 한 장이 태스크가 되어 화면에 뜨고, 다른 한 장이 그것을 닫는다", async ({ page, request }) => {
  // 실호출 2회 + 가입 왕복 + 화면 전환. 배포본의 콜드 스타트까지 들어갈 수 있어 넉넉히 잡는다.
  test.setTimeout(180_000);

  const admin = createAdminClient();
  const email = newTestEmail();

  try {
    // ── 1. 가입 (`AUTH-1`) ────────────────────────────────────────────────
    // 화면의 가입 폼을 실제로 지나는 것이 핵심이다 — 배포본에서는 이 Server Action이 처음 돈다.
    // 메일 확인을 껐으므로(2026-09-25, 설계 결정 12) 가입이 곧 로그인이다.
    await page.goto("/signup");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "가입하기" }).click();
    // 새 계정은 방침 동의를 먼저 지난다(HF-06). 동의 전이면 아래 캡처가 403이다.
    await expect(page).toHaveURL(/\/consent$/);
    await acceptConsentThroughUi(page);
    await expect(page).toHaveURL(/\/dashboard$/);

    // 앱이 쓰는 것과 같은 Bearer 토큰을 따로 연다. 브라우저 쿠키 세션과 별개의 세션이다
    // — 앱과 웹이 세션을 나눠 쓰지 않는 것과 같은 모양(설계 결정 18).
    const client = createPublicClient();
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();
    const user: TestUser = {
      user: signedIn.session!.user,
      client,
      email,
      password: PASSWORD,
      accessToken: signedIn.session!.access_token,
    };

    // 에이전트가 고를 기존 태그(`AGT-5`). '미분류'는 가입 트리거가 이미 만들었다.
    const tagIds = await seedTags(user, ["군무", "학업", "여행"]);

    // ── 2. 생성 캡처 (`AGT-1`·`AGT-4`·`API-3`) ───────────────────────────
    const createResult = await dataOf<CaptureData>(
      await request.post(CAPTURES, {
        headers: bearer(user.accessToken),
        multipart: {
          image: await imagePart(CREATE_FIXTURE),
          mode: "create",
          capturedAt: CREATE_FIXTURE.capturedAt,
          timezone: TZ,
        },
      }),
    );

    expect(createResult.outcome).toBe("created");
    expect(createResult.jobLogId).toBeTruthy();
    expect(createResult.failure).toBeNull();
    expect(createResult.created).toHaveLength(1);

    const task = createResult.created[0]!;
    expect(task.title).toContain("설문");
    // '다음 주 월요일'이 절대 날짜가 됐다. 날짜만 드러났으므로 그날의 끝이다(설계 결정 14).
    expect(task.dueAt).toBe(toDueAt("2026-09-21", null, TZ));
    expect(task.dueHasTime).toBe(false);
    // 태그가 하나 붙었고, 그것이 이 사용자의 태그 목록 안에 있다.
    //
    // **어느 태그인지는 보지 않는다.** `AGT-5`는 "기존 태그에 먼저 배정, 애매하면 '미분류'"라
    // '미분류'도 요구사항을 만족한다. 실제로 이 캡처는 '학업'과 '미분류' 사이에서 흔들린다
    // (L-P0-08 알려진 한계 — "태그 이름만으로는 영역이 모호하다"). 태그 정확도를 재는 곳은
    // 평가 세트(`npm run grade`)이고, 여기서 그 기준을 다시 세우면 통합 검증이 에이전트 품질의
    // 인질이 된다. 이 스펙이 지키는 것은 **배정이 일어났고 유효한 태그다**까지다.
    expect(task.tags).toHaveLength(1);
    expect([...tagIds.keys()]).toContain(task.tags[0]);
    // 근거는 사용자가 사후 교정할 때 읽는 문장이다 — 비어 있으면 교정 동선이 빈칸이 된다.
    expect(task.rationale.length).toBeGreaterThan(0);

    // ── 3. 대시보드에 뜬다 (`DASH-1`) ────────────────────────────────────
    // 첫 화면은 '오늘' 보기다(`L-P1-10`). 픽스처의 마감이 이미 지난 날이라 여기 선다.
    await page.goto("/dashboard");
    const todo = page.getByRole("region", { name: "오늘" });
    await expect(todo.getByRole("heading", { level: 3 })).toHaveText([task.title]);
    // 마감이 지난 건이라 `overdue`로 분류된다 = 판정이 `profiles.timezone`을 탔다(설계 결정 19).
    await expect(todo.locator('li[data-due="overdue"]')).toContainText(task.title);

    // 여기서부터 이 탭은 손대지 않는다. 표식이 살아남으면 전체 재로드가 없었다는 뜻이다.
    const probe = await plantProbe(page);

    // ── 4. 방해 태스크를 심는다 (`AGT-6`의 함정) ─────────────────────────
    for (const distractor of DISTRACTORS) {
      const { error } = await user.client.rpc("create_task", {
        p_title: distractor.title,
        p_due_at: toDueAt(distractor.dueAt, null, TZ) ?? undefined,
        p_due_has_time: false,
        p_tag_ids: [tagIds.get("학업")!],
      });
      expect(error).toBeNull();
    }
    await expect(todo.getByRole("heading", { level: 3 })).toHaveCount(3);

    // ── 5. 완료 캡처 (`AGT-6`) ───────────────────────────────────────────
    const completeResult = await dataOf<CaptureData>(
      await request.post(CAPTURES, {
        headers: bearer(user.accessToken),
        multipart: {
          image: await imagePart(COMPLETE_FIXTURE),
          mode: "complete",
          capturedAt: COMPLETE_FIXTURE.capturedAt,
          timezone: TZ,
        },
      }),
    );

    expect(completeResult.outcome).toBe("completed");
    expect(completeResult.failure).toBeNull();
    // 같은 날 마감인 방해 태스크가 아니라 **캡처가 만든 바로 그 태스크**를 닫았다.
    expect(completeResult.completed?.id).toBe(task.id);

    // 판정은 반환값이 아니라 DB에 남은 것으로 한 번 더 본다. 사용자가 보게 되는 것이 그것이다.
    const { data: rows, error: readError } = await user.client.from("tasks").select("title, status");
    expect(readError).toBeNull();
    expect(rows!.filter((row) => row.status === "done").map((row) => row.title)).toEqual([task.title]);
    expect(rows!.filter((row) => row.status === "todo")).toHaveLength(2);

    // ── 6. 열어 둔 화면이 스스로 따라온다 (`DASH-5`) ─────────────────────
    // 지난 마감의 완료는 '오늘'에서 빠진다(마감이 오늘인 완료만 남는다, `DASH-9`).
    await expect(todo.getByText(task.title)).toHaveCount(0);
    expect(await readProbe(page)).toBe(probe);
    await page.goto("/dashboard?view=done");
    await expect(
      page.getByRole("region", { name: "완료" }).getByRole("heading", { level: 3 }),
    ).toHaveText([task.title]);
  } finally {
    // 화면으로 가입한 계정이라 테스트가 id를 모른다 — 이메일로 찾아 지운다.
    await deleteUserByEmail(admin, email);
  }
});
