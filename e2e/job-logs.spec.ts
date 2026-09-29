import { expect, test, type APIRequestContext } from "@playwright/test";

import { bearer, bodyOf, dataOf, expectFailure } from "./support/api";
import { createAdminClient, createSignedInUser, deleteUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P1-01 검증 — 작업 로그 조회(`HIST-1`, `API-6`).
 *
 * **LLM을 부르지 않는다.** `job_logs`의 RLS가 본인 행 쓰기를 허용하므로 테스트가 로그를 직접 심어
 * 네 갈래(생성 성공·완료 성공·실패·메일)를 **결정적으로** 그릴 수 있다. 비용 0, 흔들림 0이고
 * `mail` 소스까지 여기서 검증된다.
 */
test.describe.configure({ mode: "serial" });

const JOB_LOGS = "/api/v1/job-logs";

interface JobLog {
  id: string;
  createdAt: string;
  source: string;
  outcome: string;
  failureReason: string | null;
  captureSummary: string | null;
  rationale: string | null;
  handledAt: string | null;
  tasks: { id: string; title: string }[];
  revertable: boolean;
}

/** 응답 항목이 가져야 할 칸 전부. 계측 칸이 새면 이 배열과 어긋나 바로 빨간불이 된다. */
const PAYLOAD_KEYS = [
  "captureSummary",
  "createdAt",
  "failureReason",
  "handledAt",
  "id",
  "outcome",
  "rationale",
  "revertable",
  "source",
  "tasks",
];

const COMPLETE_RATIONALE = "캡처의 '완료' 표시가 이 태스크의 제목과 같다.";
const FAILED_SUMMARY = "커피 사진. 업무와 무관해 보인다.";

test.describe("작업 로그 조회", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;

  // 심은 로그의 id — 기대 순서를 id 배열로 비교한다.
  let mailLogId: string;
  let completedLogId: string;
  let createdLogId: string;
  let failedLogId: string;
  // 생성 로그가 만든 태스크 둘 + 완료 로그가 닫은 태스크 하나.
  let createdTaskIds: string[];
  let completedTaskId: string;

  const as = (user: TestUser) => ({ headers: bearer(user.accessToken) });

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    // 시각을 손으로 심고 **일부러 뒤섞인 순서로** insert한다. 그대로 나오면 통과해 버리는 함정을 피한다.
    const { data: logs, error: logError } = await alice.client
      .from("job_logs")
      .insert([
        {
          user_id: alice.user.id,
          source: "capture_complete",
          outcome: "completed",
          capture_summary: "카카오톡에서 설문 응답을 마쳤다는 메시지.",
          rationale: COMPLETE_RATIONALE,
          created_at: "2026-09-24T03:00:00Z",
        },
        {
          user_id: alice.user.id,
          source: "capture_create",
          outcome: "failed",
          failure_reason: "NO_TASK_TO_CREATE",
          capture_summary: FAILED_SUMMARY,
          created_at: "2026-09-24T01:00:00Z",
        },
        {
          // 계측이 가득 찬 행 — 이 칸들이 응답에 새지 않는지 본다.
          user_id: alice.user.id,
          source: "mail",
          outcome: "created",
          capture_summary: "메일 소스 테스트용 요약.",
          model: "gpt-5.6-luna",
          prompt_tokens: 2872,
          completion_tokens: 43,
          latency_ms: 3600,
          created_at: "2026-09-24T04:00:00Z",
        },
        {
          user_id: alice.user.id,
          source: "capture_create",
          outcome: "created",
          capture_summary: "노트 앱에 적힌 할 일 두 가지.",
          created_at: "2026-09-24T02:00:00Z",
        },
      ])
      .select("id, created_at");
    expect(logError).toBeNull();

    const byTime = new Map(logs!.map((row) => [row.created_at.slice(11, 13), row.id]));
    failedLogId = byTime.get("01")!;
    createdLogId = byTime.get("02")!;
    completedLogId = byTime.get("03")!;
    mailLogId = byTime.get("04")!;

    // 생성 로그가 만든 태스크 둘 + 그 로그와 무관한 직접 생성 태스크 하나.
    const { data: created, error: createdError } = await alice.client
      .from("tasks")
      .insert([
        // `updated_at`을 `created_at`과 같게 못 박는다. 안 주면 기본값 `now()`가 들어가 둘이
        // 달라지고, 되돌리기 판정(`HIST-4`의 "그 사이 수정됨")이 이 태스크들을 수정된 것으로
        // 본다 — 트리거가 UPDATE에만 걸려 생성 직후에는 두 값이 같은 것이 정상이다.
        {
          user_id: alice.user.id,
          title: "교양 발표 PPT 만들기",
          source: "capture_create",
          job_log_id: createdLogId,
          created_at: "2026-09-24T02:00:01Z",
          updated_at: "2026-09-24T02:00:01Z",
        },
        {
          user_id: alice.user.id,
          title: "발표 대본 다듬기",
          source: "capture_create",
          job_log_id: createdLogId,
          created_at: "2026-09-24T02:00:02Z",
          updated_at: "2026-09-24T02:00:02Z",
        },
        // 배열 insert는 행마다 칸을 채워야 한다 — 비우면 기본값이 아니라 null이 들어가 제약에 걸린다.
        {
          user_id: alice.user.id,
          title: "직접 적은 할 일",
          source: "manual",
          job_log_id: null,
          created_at: "2026-09-24T02:30:00Z",
          updated_at: "2026-09-24T02:30:00Z",
        },
      ])
      .select("id, created_at");
    expect(createdError).toBeNull();
    createdTaskIds = created!
      .filter((row) => row.created_at.startsWith("2026-09-24T02:00:0"))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((row) => row.id);
    expect(createdTaskIds).toHaveLength(2);

    // 완료 로그가 닫은 태스크 하나.
    const { data: done, error: doneError } = await alice.client
      .from("tasks")
      .insert({
        user_id: alice.user.id,
        title: "PULSE 사전 설문조사 응답하기",
        source: "manual",
        status: "done",
        completed_by_job_log_id: completedLogId,
      })
      .select("id")
      .single();
    expect(doneError).toBeNull();
    completedTaskId = done!.id;

    // 100건 컷을 보려고 더미를 **더 과거로** 민다 — 위 넷이 상위 100에 남아야 한다.
    const filler = Array.from({ length: 100 }, (_, i) => ({
      user_id: alice.user.id,
      source: "capture_create" as const,
      outcome: "created" as const,
      capture_summary: `더미 ${i}`,
      created_at: `2026-09-23T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    const { error: fillerError } = await alice.client.from("job_logs").insert(filler);
    expect(fillerError).toBeNull();
  });

  test.afterAll(async () => {
    for (const user of [alice, bob]) {
      if (user) await deleteUser(admin, user.user.id);
    }
  });

  test("로그가 없으면 빈 배열이다 — 남의 로그는 새지 않는다", async ({ request }) => {
    // alice가 104건을 가진 시점이다. bob이 빈 배열을 받는 것이 곧 격리의 증거다.
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(bob)));
    expect(list).toEqual([]);
  });

  test("최신순으로 오고 100건에서 끊긴다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));

    expect(list).toHaveLength(100);
    // 심은 순서(완료·실패·메일·생성)가 아니라 시각 역순으로 온다.
    expect(list.slice(0, 4).map((log) => log.id)).toEqual([
      mailLogId,
      completedLogId,
      createdLogId,
      failedLogId,
    ]);
    // 가장 오래된 더미 넷은 잘려 나갔다.
    expect(list.map((log) => log.captureSummary)).not.toContain("더미 0");
  });

  test("생성 로그에 그 캡처가 만든 태스크가 전부 실린다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));
    const log = list.find((item) => item.id === createdLogId)!;

    expect(log).toMatchObject({ source: "capture_create", outcome: "created", failureReason: null });
    // 직접 적은 할 일은 섞이지 않는다 — 그 태스크는 어느 로그도 가리키지 않는다.
    expect(log.tasks).toEqual([
      { id: createdTaskIds[0], title: "교양 발표 PPT 만들기" },
      { id: createdTaskIds[1], title: "발표 대본 다듬기" },
    ]);
    // 완료 근거는 생성 로그에서 비어 있다 — 생성의 근거는 태스크마다 달라 tasks.rationale에 있다.
    expect(log.rationale).toBeNull();
  });

  test("완료 로그에 닫은 태스크 하나와 근거가 실린다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));
    const log = list.find((item) => item.id === completedLogId)!;

    expect(log).toMatchObject({
      source: "capture_complete",
      outcome: "completed",
      failureReason: null,
      rationale: COMPLETE_RATIONALE,
    });
    expect(log.tasks).toEqual([{ id: completedTaskId, title: "PULSE 사전 설문조사 응답하기" }]);
  });

  test("실패 로그가 사유와 요약을 낸다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));
    const log = list.find((item) => item.id === failedLogId)!;

    expect(log).toMatchObject({
      source: "capture_create",
      outcome: "failed",
      failureReason: "NO_TASK_TO_CREATE",
      captureSummary: FAILED_SUMMARY,
      // '확인 필요'에서 아직 처리하지 않았다(`DASH-11`). 처리 뒤의 값은 `needs-review.spec.ts`가 본다.
      handledAt: null,
    });
    expect(log.tasks).toEqual([]);
  });

  test("계측 칸은 응답에 실리지 않는다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));

    // 항목 하나가 아니라 전부를 본다 — 계측이 가득 찬 mail 로그가 그중에 있다.
    for (const log of list) {
      expect(Object.keys(log).sort()).toEqual(PAYLOAD_KEYS);
    }
    expect(list.some((log) => log.id === mailLogId)).toBe(true);
  });

  test("revertable이 네 갈래를 가른다", async ({ request }) => {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(alice)));
    const at = (id: string) => list.find((log) => log.id === id)!.revertable;

    // 손대지 않은 태스크를 가진 생성 로그와, 아직 done인 완료 로그는 되돌릴 수 있다.
    expect(at(createdLogId)).toBe(true);
    expect(at(completedLogId)).toBe(true);
    // 실패 로그는 쓴 것이 없고, 더미 생성 로그는 가리키는 태스크가 없다.
    expect(at(failedLogId)).toBe(false);
    expect(list.filter((log) => log.captureSummary?.startsWith("더미")).map((log) => log.revertable))
      .not.toContain(true);
  });

  test("토큰이 없으면 401이다", async ({ request }) => {
    await expectFailure(await request.get(JOB_LOGS), "UNAUTHORIZED", 401);
  });
});

/**
 * L-P1-02 검증 — 되돌리기(`HIST-3`, `HIST-4`, `API-6`).
 *
 * **테스트마다 자기 로그와 태스크를 심는다.** 파일이 serial 모드라 되돌리기가 앞 테스트의
 * 데이터를 파괴할 수 있는데, 공유 상태를 아예 없애면 순서 의존이 사라진다. "재실행하면 409"처럼
 * 앞 결과를 물려받아야 하는 것은 **한 테스트 안에서 두 번 호출**해 해결한다.
 *
 * 시드가 `created_at`·`updated_at`을 주지 않는 것이 의도다 — 둘 다 `now()`가 되어 "아무도
 * 손대지 않았다"(`updated_at = created_at`)가 성립한다. 위 describe처럼 시각을 손으로 박을 때는
 * 두 칸을 **같은 값으로** 줘야 한다.
 */
test.describe("작업 로그 되돌리기", () => {
  let admin: DochiClient;
  let carol: TestUser;
  let dave: TestUser;

  const as = (user: TestUser) => ({ headers: bearer(user.accessToken) });
  const revertPath = (id: string) => `${JOB_LOGS}/${id}/revert`;

  /** 생성 로그 하나와 그 로그가 만든 태스크들. */
  async function seedCreateLog(user: TestUser, titles: string[]) {
    const { data: log, error: logError } = await user.client
      .from("job_logs")
      .insert({
        user_id: user.user.id,
        source: "capture_create",
        outcome: "created",
        capture_summary: "되돌리기 시드 — 생성",
      })
      .select("id")
      .single();
    expect(logError).toBeNull();

    const { data: tasks, error: taskError } = await user.client
      .from("tasks")
      .insert(
        titles.map((title) => ({
          user_id: user.user.id,
          title,
          source: "capture_create" as const,
          job_log_id: log!.id,
        })),
      )
      .select("id, created_at");
    expect(taskError).toBeNull();

    const taskIds = tasks!
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((row) => row.id);
    return { logId: log!.id, taskIds };
  }

  /** 완료 로그 하나와 그 로그가 닫은 태스크. */
  async function seedCompleteLog(user: TestUser, title: string) {
    const { data: log, error: logError } = await user.client
      .from("job_logs")
      .insert({
        user_id: user.user.id,
        source: "capture_complete",
        outcome: "completed",
        capture_summary: "되돌리기 시드 — 완료",
        rationale: COMPLETE_RATIONALE,
      })
      .select("id")
      .single();
    expect(logError).toBeNull();

    const { data: task, error: taskError } = await user.client
      .from("tasks")
      .insert({
        user_id: user.user.id,
        title,
        source: "manual",
        status: "done",
        completed_by_job_log_id: log!.id,
      })
      .select("id")
      .single();
    expect(taskError).toBeNull();

    return { logId: log!.id, taskId: task!.id };
  }

  async function seedFailedLog(user: TestUser) {
    const { data, error } = await user.client
      .from("job_logs")
      .insert({
        user_id: user.user.id,
        source: "capture_create",
        outcome: "failed",
        failure_reason: "NO_TASK_TO_CREATE",
        capture_summary: "되돌리기 시드 — 실패",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id;
  }

  /** 목록에서 그 로그의 `revertable`을 읽는다. */
  async function revertableOf(request: APIRequestContext, user: TestUser, logId: string) {
    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(user)));
    return list.find((log) => log.id === logId)!.revertable;
  }

  test.beforeAll(async () => {
    admin = createAdminClient();
    carol = await createSignedInUser(admin);
    dave = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    for (const user of [carol, dave]) {
      if (user) await deleteUser(admin, user.user.id);
    }
  });

  test("생성 로그를 되돌리면 만든 태스크가 전부 지워진다", async ({ request }) => {
    const { logId, taskIds } = await seedCreateLog(carol, ["A 초안 쓰기", "B 자료 모으기"]);
    // 태그 연결도 하나 달아 둔다 — 태스크 삭제가 CASCADE로 데려가는지 함께 본다.
    const { data: tag } = await carol.client
      .from("tags")
      .select("id")
      .eq("name", "미분류")
      .single();
    await carol.client
      .from("task_tags")
      .insert({ task_id: taskIds[0]!, tag_id: tag!.id, user_id: carol.user.id });

    const data = await dataOf<{ jobLogId: string; reverted: string; taskIds: string[] }>(
      await request.post(revertPath(logId), as(carol)),
    );

    expect(Object.keys(data).sort()).toEqual(["jobLogId", "reverted", "taskIds"]);
    expect(data).toEqual({ jobLogId: logId, reverted: "created", taskIds });

    const { data: left } = await carol.client.from("tasks").select("id").in("id", taskIds);
    expect(left).toEqual([]);
    const { data: links } = await carol.client
      .from("task_tags")
      .select("task_id")
      .eq("task_id", taskIds[0]!);
    expect(links).toEqual([]);
  });

  test("같은 생성 로그를 다시 되돌리면 409다", async ({ request }) => {
    const { logId } = await seedCreateLog(carol, ["한 번만 지워질 일"]);

    await dataOf(await request.post(revertPath(logId), as(carol)));
    await expectFailure(
      await request.post(revertPath(logId), as(carol)),
      "REVERT_NOT_POSSIBLE",
      409,
    );

    expect(await revertableOf(request, carol, logId)).toBe(false);
  });

  test("하나라도 수정됐으면 전부 남고 409다", async ({ request }) => {
    const { logId, taskIds } = await seedCreateLog(carol, ["가", "나", "다"]);

    // 가운데 하나만 사용자가 고친다.
    const patched = await request.patch(`/api/v1/tasks/${taskIds[1]}`, {
      ...as(carol),
      data: { title: "나 — 사용자가 고침" },
    });
    expect(patched.status()).toBe(200);

    const body = await bodyOf(await request.post(revertPath(logId), as(carol)));
    expect(body).toEqual({
      error: {
        code: "REVERT_NOT_POSSIBLE",
        message: "생성 이후 태스크가 변경되어 되돌릴 수 없습니다.",
      },
    });

    // all-or-nothing — 손대지 않은 둘까지 그대로 남아 있다.
    const { data: left } = await carol.client.from("tasks").select("id").in("id", taskIds);
    expect(left).toHaveLength(3);
    expect(await revertableOf(request, carol, logId)).toBe(false);
  });

  test("생성 태스크가 이미 지워졌으면 409다", async ({ request }) => {
    const { logId, taskIds } = await seedCreateLog(carol, ["사용자가 직접 지울 일"]);
    await carol.client.from("tasks").delete().eq("id", taskIds[0]!);

    const body = await bodyOf(await request.post(revertPath(logId), as(carol)));
    expect(body).toEqual({
      error: { code: "REVERT_NOT_POSSIBLE", message: "되돌릴 태스크가 남아 있지 않습니다." },
    });
  });

  test("완료 로그를 되돌리면 할 일로 돌아가고 연결은 남는다", async ({ request }) => {
    const { logId, taskId } = await seedCompleteLog(carol, "설문 응답하기");

    const data = await dataOf<{ jobLogId: string; reverted: string; taskIds: string[] }>(
      await request.post(revertPath(logId), as(carol)),
    );
    expect(data).toEqual({ jobLogId: logId, reverted: "completed", taskIds: [taskId] });

    const { data: task } = await carol.client
      .from("tasks")
      .select("status, completed_by_job_log_id")
      .eq("id", taskId)
      .single();
    // 연결을 남기는 것이 결정이다(2026-09-24) — 히스토리에서 무엇을 되돌렸는지가 보여야 한다.
    expect(task).toEqual({ status: "todo", completed_by_job_log_id: logId });

    const list = await dataOf<JobLog[]>(await request.get(JOB_LOGS, as(carol)));
    const log = list.find((item) => item.id === logId)!;
    expect(log.tasks).toEqual([{ id: taskId, title: "설문 응답하기" }]);
    expect(log.revertable).toBe(false);
  });

  test("같은 완료 로그를 다시 되돌리면 409다", async ({ request }) => {
    const { logId } = await seedCompleteLog(carol, "한 번만 열릴 일");

    await dataOf(await request.post(revertPath(logId), as(carol)));
    const body = await bodyOf(await request.post(revertPath(logId), as(carol)));
    // 태스크가 살아 있으므로 TASK_GONE이 아니라 '이미 되돌림'으로 갈린다.
    expect(body).toEqual({
      error: { code: "REVERT_NOT_POSSIBLE", message: "이미 되돌린 작업입니다." },
    });
  });

  test("완료 태스크가 지워졌으면 409다", async ({ request }) => {
    const { logId, taskId } = await seedCompleteLog(carol, "지워질 완료 태스크");
    await carol.client.from("tasks").delete().eq("id", taskId);

    const body = await bodyOf(await request.post(revertPath(logId), as(carol)));
    expect(body).toEqual({
      error: { code: "REVERT_NOT_POSSIBLE", message: "되돌릴 태스크가 남아 있지 않습니다." },
    });
  });

  test("실패 로그는 되돌릴 것이 없다", async ({ request }) => {
    const logId = await seedFailedLog(carol);

    const body = await bodyOf(await request.post(revertPath(logId), as(carol)));
    expect(body).toEqual({
      error: { code: "REVERT_NOT_POSSIBLE", message: "되돌릴 내용이 없는 기록입니다." },
    });
    expect(await revertableOf(request, carol, logId)).toBe(false);
  });

  test("남의 로그·없는 로그·비-UUID가 본문까지 같은 404다", async ({ request }) => {
    const { logId, taskId } = await seedCompleteLog(carol, "dave가 못 건드릴 일");
    const others = revertPath(logId);
    const missing = revertPath(crypto.randomUUID());

    for (const path of [others, missing, revertPath("not-a-uuid")]) {
      await expectFailure(await request.post(path, as(dave)), "JOB_LOG_NOT_FOUND", 404);
    }

    const a = await request.post(others, as(dave));
    const b = await request.post(missing, as(dave));
    expect(await bodyOf(a)).toEqual(await bodyOf(b));

    // dave의 시도가 carol의 태스크를 건드리지 않았다.
    const { data: task } = await carol.client
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    expect(task).toEqual({ status: "done" });
  });

  test("토큰이 없으면 401이다", async ({ request }) => {
    await expectFailure(
      await request.post(revertPath(crypto.randomUUID())),
      "UNAUTHORIZED",
      401,
    );
  });
});
