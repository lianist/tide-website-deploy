import { expect, test } from "@playwright/test";

import {
  createAdminClient,
  createPublicClient,
  createSignedInUser,
  deleteUser,
  type DochiClient,
  type TestUser,
} from "./support/supabase";

/**
 * L-P0-02 검증 — 사용자 두 명으로 서로의 행이 보이지 않는지, 그리고 계정 하나를 지우면
 * 다섯 테이블이 전부 따라 지워지는지(SET-1의 전제) 확인한다.
 *
 * 순서가 중요하다: 마지막 테스트가 alice를 지우므로 앞 테스트가 먼저 끝나야 한다.
 */
test.describe.configure({ mode: "serial" });

test.describe("RLS · CASCADE", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;

  let aliceTagId: string;
  let aliceJobLogId: string;
  let aliceTaskId: string;

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    // alice가 나머지 세 테이블을 채운다. 본인 클라이언트로 넣으므로 이 삽입이 성공한다는 것
    // 자체가 "본인 행은 쓸 수 있다"의 확인이기도 하다.
    //
    // profiles와 tags는 넣지 않는다 — 가입 부트스트랩 트리거(`on_auth_user_created`)가 계정을
    // 만들 때 이미 채워 두기 때문에 여기서 또 넣으면 PK·유니크 제약에 걸린다(L-P0-03).
    // 대신 profiles는 update로 "본인 행 쓰기"를 확인한다. update는 정책의 using과 with check를
    // 모두 통과해야 하므로 insert보다 넓은 확인이다.
    const { data: profile, error: profileError } = await alice.client
      .from("profiles")
      .update({ timezone: "Asia/Seoul" })
      .eq("id", alice.user.id)
      .select("id")
      .single();
    expect(profileError).toBeNull();
    expect(profile!.id).toBe(alice.user.id);

    // 트리거가 만들어 준 '미분류'를 아래 task_tags 연결에 쓴다. "태그를 만들 수 있다"는 확인은
    // 뒤쪽 "남의 태스크에 내 태그를 달 수 없다"에서 bob이 실제로 만들며 이미 성립한다.
    const { data: tag, error: tagError } = await alice.client
      .from("tags")
      .select("id")
      .eq("name", "미분류")
      .single();
    expect(tagError).toBeNull();
    aliceTagId = tag!.id;

    const { data: jobLog, error: jobLogError } = await alice.client
      .from("job_logs")
      .insert({
        user_id: alice.user.id,
        source: "capture_create",
        outcome: "created",
        capture_summary: "L-P0-02 검증용 캡처 요약",
      })
      .select("id")
      .single();
    expect(jobLogError).toBeNull();
    aliceJobLogId = jobLog!.id;

    const { data: task, error: taskError } = await alice.client
      .from("tasks")
      .insert({
        user_id: alice.user.id,
        title: "alice의 태스크",
        source: "capture_create",
        job_log_id: aliceJobLogId,
        rationale: "검증용으로 직접 넣었다.",
      })
      .select("id")
      .single();
    expect(taskError).toBeNull();
    aliceTaskId = task!.id;

    const { error: linkError } = await alice.client
      .from("task_tags")
      .insert({ task_id: aliceTaskId, tag_id: aliceTagId, user_id: alice.user.id });
    expect(linkError).toBeNull();
  });

  test.afterAll(async () => {
    // alice는 CASCADE 테스트가 지운다. 실패로 중단됐을 경우를 대비해 한 번 더 시도한다.
    for (const user of [alice, bob]) {
      if (!user) continue;
      await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    }
  });

  test("본인 행은 다섯 테이블에서 모두 보인다", async () => {
    const { data: profiles } = await alice.client.from("profiles").select("id");
    const { data: tags } = await alice.client.from("tags").select("id");
    const { data: jobLogs } = await alice.client.from("job_logs").select("id");
    const { data: tasks } = await alice.client.from("tasks").select("id");
    const { data: taskTags } = await alice.client.from("task_tags").select("task_id");

    expect(profiles).toHaveLength(1);
    expect(tags).toHaveLength(1);
    expect(jobLogs).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(taskTags).toHaveLength(1);
  });

  test("남의 행은 보이지 않고, 보이는 것은 전부 본인 행이다", async () => {
    // RLS는 남의 행을 숨긴다 — 에러가 아니라 빈 결과로 나오는 것이 정상이다.
    const { data: profiles } = await bob.client.from("profiles").select("id");
    const { data: tags } = await bob.client.from("tags").select("user_id");
    const { data: jobLogs } = await bob.client.from("job_logs").select("id");
    const { data: tasks } = await bob.client.from("tasks").select("id");
    const { data: taskTags } = await bob.client.from("task_tags").select("task_id");

    // profiles와 tags는 비어 있지 않다 — 가입 부트스트랩 트리거가 bob에게도 프로필 한 행과
    // '미분류' 태그를 만들어 주기 때문이다. RLS가 지켜야 하는 것은 "결과가 비었다"가 아니라
    // **"보이는 행이 전부 bob의 것"** 이므로, 느슨하게 풀지 않고 완전 일치로 단언한다.
    // 이렇게 두면 남의 행이 섞여도, 본인 행이 사라져도 실패한다.
    expect(profiles).toEqual([{ id: bob.user.id }]);
    expect(tags).toEqual([{ user_id: bob.user.id }]);

    // alice만 채운 세 테이블은 bob에게 그대로 비어 있어야 한다.
    expect(jobLogs).toEqual([]);
    expect(tasks).toEqual([]);
    expect(taskTags).toEqual([]);
  });

  test("id를 알아도 남의 태스크는 읽을 수 없다", async () => {
    const { data } = await bob.client.from("tasks").select("id").eq("id", aliceTaskId);

    expect(data).toEqual([]);
  });

  test("남의 태스크는 수정하거나 지울 수 없다", async () => {
    await bob.client.from("tasks").update({ status: "done" }).eq("id", aliceTaskId);
    await bob.client.from("tasks").delete().eq("id", aliceTaskId);

    // alice 쪽에서 아무 일도 없었는지 확인한다. RLS는 조용히 0행을 처리하므로
    // 에러가 아니라 대상 행의 상태로 판정해야 한다.
    const { data } = await alice.client
      .from("tasks")
      .select("id, status")
      .eq("id", aliceTaskId)
      .single();

    expect(data?.status).toBe("todo");
  });

  test("남의 user_id로는 행을 만들 수 없다", async () => {
    const { error } = await bob.client
      .from("tasks")
      .insert({ user_id: alice.user.id, title: "가로채기", source: "manual" });

    expect(error).not.toBeNull();
  });

  test("남의 태스크에 내 태그를 달 수 없다", async () => {
    const { data: bobTag } = await bob.client
      .from("tags")
      .insert({ user_id: bob.user.id, name: "bob의 태그" })
      .select("id")
      .single();

    // user_id는 bob의 것이라 RLS는 통과하지만, 복합 FK가 "bob의 소유로 등록된 alice의 태스크"를
    // 찾지 못해 거부한다. 스키마가 막는 자리다.
    const { error } = await bob.client
      .from("task_tags")
      .insert({ task_id: aliceTaskId, tag_id: bobTag!.id, user_id: bob.user.id });

    expect(error).not.toBeNull();
  });

  test("로그인하지 않으면 아무것도 읽을 수 없다", async () => {
    const anon = createPublicClient();

    const { data } = await anon.from("tasks").select("id");

    expect(data).toEqual([]);
  });

  test("계정을 지우면 다섯 테이블의 행이 전부 따라 지워진다", async () => {
    await deleteUser(admin, alice.user.id);

    // RLS를 우회하는 관리자 클라이언트로 센다. 숨겨진 것이 아니라 없어진 것이어야 한다.
    const counts = await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }).eq("id", alice.user.id),
      admin.from("tags").select("*", { count: "exact", head: true }).eq("user_id", alice.user.id),
      admin
        .from("job_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", alice.user.id),
      admin.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", alice.user.id),
      admin
        .from("task_tags")
        .select("*", { count: "exact", head: true })
        .eq("user_id", alice.user.id),
    ]);

    expect(counts.map((result) => result.count)).toEqual([0, 0, 0, 0, 0]);

    // bob은 남아 있어야 한다 — CASCADE가 남의 행까지 쓸어가면 그것도 버그다.
    // 둘인 이유: 가입 트리거가 만든 '미분류'와, 위에서 직접 만든 'bob의 태그'.
    const { count: bobTags } = await admin
      .from("tags")
      .select("*", { count: "exact", head: true })
      .eq("user_id", bob.user.id);
    expect(bobTags).toBe(2);
  });
});
