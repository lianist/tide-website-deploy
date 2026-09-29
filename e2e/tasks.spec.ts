import { expect, test, type APIRequestContext } from "@playwright/test";

import { bearer, bodyOf, dataOf, expectFailure } from "./support/api";
import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-06 검증 — 태스크 CRUD(`API-2`).
 *
 * 핵심 넷: 생성이 태그와 함께 **원자적**인지, 목록이 `DASH-1` 순서인지, 상태가 `todo` ↔ `done`으로
 * 오가는지, 남의 태스크는 무엇을 해도 404인지.
 */
test.describe.configure({ mode: "serial" });

const TASKS = "/api/v1/tasks";

interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  status: "todo" | "done";
  source: string;
  rationale: string | null;
  tags: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

test.describe("태스크 CRUD", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;
  /** alice의 태그 둘. 가입 트리거가 만든 '미분류'와 별도로 직접 만든다. */
  let work: { id: string; name: string };
  let home: { id: string; name: string };
  let bobTagId: string;

  const as = (user: TestUser) => ({ headers: bearer(user.accessToken) });

  async function createTask(request: APIRequestContext, user: TestUser, body: object) {
    return dataOf<Task>(await request.post(TASKS, { ...as(user), data: body }));
  }

  async function countTasks(user: TestUser): Promise<number> {
    const { count } = await user.client.from("tasks").select("id", { count: "exact", head: true });
    return count ?? -1;
  }

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    const { data: tags, error } = await alice.client
      .from("tags")
      .insert([
        { user_id: alice.user.id, name: "업무" },
        { user_id: alice.user.id, name: "집" },
      ])
      .select("id, name");
    expect(error).toBeNull();
    work = tags!.find((tag) => tag.name === "업무")!;
    home = tags!.find((tag) => tag.name === "집")!;

    const { data: bobTag } = await bob.client
      .from("tags")
      .select("id")
      .eq("name", "미분류")
      .single();
    bobTagId = bobTag!.id;
  });

  test.afterAll(async () => {
    for (const user of [alice, bob]) {
      if (!user) continue;
      await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    }
  });

  test("새 경로는 전부 토큰 없이 401이다", async ({ request }) => {
    const path = `${TASKS}/${crypto.randomUUID()}`;
    await expectFailure(await request.get(TASKS), "UNAUTHORIZED", 401);
    await expectFailure(await request.post(TASKS, { data: { title: "x" } }), "UNAUTHORIZED", 401);
    await expectFailure(await request.patch(path, { data: { title: "x" } }), "UNAUTHORIZED", 401);
    await expectFailure(await request.delete(path), "UNAUTHORIZED", 401);
  });

  test("생성하면 manual · todo로 태그와 함께 돌아온다", async ({ request }) => {
    const task = await createTask(request, alice, {
      title: "  제안서 보내기  ",
      description: "초안 v2",
      dueAt: "2026-09-25T18:00:00+09:00",
      tagIds: [work.id, home.id, work.id],
    });

    expect(task.title).toBe("제안서 보내기");
    expect(task.description).toBe("초안 v2");
    // 시각은 UTC로 정규화되어 나간다(계약 §명명).
    expect(new Date(task.dueAt!).toISOString()).toBe("2026-09-25T09:00:00.000Z");
    // 타임스탬프만 보내면 시각이 있는 마감이다(설계 결정 14).
    expect(task.dueHasTime).toBe(true);
    expect(task.status).toBe("todo");
    expect(task.source).toBe("manual");
    expect(task.rationale).toBeNull();
    // 중복 id는 한 번만, 이름순.
    expect(task.tags).toEqual([work, home].sort((a, b) => a.name.localeCompare(b.name)));

    const fetched = await dataOf<Task>(await request.get(`${TASKS}/${task.id}`, as(alice)));
    expect(fetched).toEqual(task);
  });

  test("형식이 틀린 생성 요청은 400이다", async ({ request }) => {
    const bad = [
      {},
      { title: "   " },
      { title: 1 },
      { title: "x", dueAt: "내일" },
      { title: "x", tagIds: ["not-a-uuid"] },
      { title: "x", tagIds: work.id },
      { title: "x", description: 3 },
      { title: "x", dueHasTime: false },
      { title: "x", dueAt: null, dueHasTime: true },
      { title: "x", dueAt: "2026-09-25T23:59:59+09:00", dueHasTime: "no" },
    ];
    for (const data of bad) {
      await expectFailure(await request.post(TASKS, { ...as(alice), data }), "VALIDATION_FAILED", 400);
    }
    // JSON이 아닌 본문
    const headers = { ...bearer(alice.accessToken), "Content-Type": "application/json" };
    await expectFailure(await request.post(TASKS, { headers, data: "{" }), "VALIDATION_FAILED", 400);
  });

  test("남의 태그가 섞이면 400이고 태스크도 남지 않는다 (원자성)", async ({ request }) => {
    const before = await countTasks(alice);

    for (const tagIds of [[work.id, bobTagId], [crypto.randomUUID()]]) {
      const response = await request.post(TASKS, {
        ...as(alice),
        data: { title: "반쯤 만들어지면 안 되는 태스크", tagIds },
      });
      await expectFailure(response, "VALIDATION_FAILED", 400);
    }

    expect(await countTasks(alice)).toBe(before);
  });

  test("목록은 DASH-1 순서다 — 미완료 먼저, 마감 임박 순, 마감 없는 것은 끝", async ({ request }) => {
    // 정확한 순서를 단언하려고 태스크가 없는 새 사용자를 쓴다.
    const carol = await createSignedInUser(admin);
    try {
      const make = (title: string, dueAt: string | null) =>
        createTask(request, carol, { title, dueAt });

      // 만드는 순서를 기대 순서와 일부러 어긋나게 둔다.
      const doneNoDue = await make("완료·마감없음", null);
      const todoLate = await make("미완료·늦은마감", "2026-10-02T00:00:00Z");
      const todoNoDue = await make("미완료·마감없음", null);
      const doneDue = await make("완료·마감", "2026-09-01T00:00:00Z");
      const todoSoon = await make("미완료·이른마감", "2026-09-23T00:00:00Z");

      for (const task of [doneNoDue, doneDue]) {
        await dataOf(await request.patch(`${TASKS}/${task.id}`, { ...as(carol), data: { status: "done" } }));
      }

      const list = await dataOf<Task[]>(await request.get(TASKS, as(carol)));
      expect(list.map((task) => task.title)).toEqual(
        [todoSoon, todoLate, todoNoDue, doneDue, doneNoDue].map((task) => task.title),
      );

      const done = await dataOf<Task[]>(await request.get(`${TASKS}?status=done`, as(carol)));
      expect(done.map((task) => task.title)).toEqual([doneDue.title, doneNoDue.title]);

      const todo = await dataOf<Task[]>(await request.get(`${TASKS}?status=todo`, as(carol)));
      expect(todo.every((task) => task.status === "todo")).toBe(true);
      expect(todo).toHaveLength(3);
    } finally {
      await admin.auth.admin.deleteUser(carol.user.id).catch(() => undefined);
    }
  });

  test("태그로 거르면 그 태그가 달린 것만 오고, 실린 태그는 잘리지 않는다", async ({ request }) => {
    const both = await createTask(request, alice, { title: "둘 다", tagIds: [work.id, home.id] });
    const homeOnly = await createTask(request, alice, { title: "집만", tagIds: [home.id] });

    const list = await dataOf<Task[]>(await request.get(`${TASKS}?tagId=${work.id}`, as(alice)));
    const ids = list.map((task) => task.id);
    expect(ids).toContain(both.id);
    expect(ids).not.toContain(homeOnly.id);
    expect(list.every((task) => task.tags.some((tag) => tag.id === work.id))).toBe(true);

    // 필터 조인과 싣는 조인이 갈라져 있는지 — '집' 태그가 여전히 실려 있어야 한다.
    expect(list.find((task) => task.id === both.id)!.tags).toHaveLength(2);
    // 필터용 별칭이 응답에 새어 나오지 않는다.
    expect(list[0]).not.toHaveProperty("tag_filter");

    // 남의 태그로 거르면 빈 목록이다(에러가 아니다).
    expect(await dataOf<Task[]>(await request.get(`${TASKS}?tagId=${bobTagId}`, as(alice)))).toEqual([]);
  });

  test("필터 값이 틀리면 400이다", async ({ request }) => {
    for (const query of ["status=doing", "status=", "tagId=not-a-uuid"]) {
      await expectFailure(await request.get(`${TASKS}?${query}`, as(alice)), "VALIDATION_FAILED", 400);
    }
  });

  test("수정 — 필드, 상태 왕복, 태그 교체와 비우기", async ({ request }) => {
    const task = await createTask(request, alice, { title: "고칠 것", dueAt: "2026-09-30T00:00:00Z", tagIds: [work.id] });
    const path = `${TASKS}/${task.id}`;
    const patch = async (data: object) => dataOf<Task>(await request.patch(path, { ...as(alice), data }));

    const renamed = await patch({ title: "고친 것", description: "메모", dueAt: null });
    expect(renamed).toMatchObject({ title: "고친 것", description: "메모", dueAt: null, dueHasTime: false, status: "todo" });
    expect(renamed.tags).toEqual([work]); // 태그를 보내지 않으면 그대로
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(task.updatedAt));

    // 날짜만 있는 마감 — 클라이언트가 그날의 끝을 보내고 시각이 없다고 표시한다.
    const dateOnly = await patch({ dueAt: "2026-10-02T23:59:59+09:00", dueHasTime: false });
    expect(new Date(dateOnly.dueAt!).toISOString()).toBe("2026-10-02T14:59:59.000Z");
    expect(dateOnly.dueHasTime).toBe(false);
    // 마감만 다시 보내면 시각이 있는 마감으로 돌아간다.
    expect((await patch({ dueAt: "2026-10-02T18:00:00+09:00" })).dueHasTime).toBe(true);

    expect((await patch({ status: "done" })).status).toBe("done");
    expect((await patch({ status: "todo" })).status).toBe("todo");

    expect((await patch({ tagIds: [home.id] })).tags).toEqual([home]);
    const cleared = await patch({ tagIds: [], description: null });
    expect(cleared.tags).toEqual([]);
    expect(cleared.description).toBeNull();
    // 에이전트가 남긴 기록은 사용자가 고치지 못한다 — 받지 않는 키는 무시된다.
    expect((await patch({ title: "고친 것", source: "mail", rationale: "조작" })).source).toBe("manual");
  });

  test("형식이 틀린 수정 요청은 400이다", async ({ request }) => {
    const task = await createTask(request, alice, { title: "수정 검증용" });
    const path = `${TASKS}/${task.id}`;

    for (const data of [{}, { rationale: "받지 않는 키만" }, { status: "doing" }, { title: "" }, { dueAt: 123 }, { dueHasTime: false }]) {
      await expectFailure(await request.patch(path, { ...as(alice), data }), "VALIDATION_FAILED", 400);
    }
    await expectFailure(
      await request.patch(path, { ...as(alice), data: { tagIds: [bobTagId] } }),
      "VALIDATION_FAILED",
      400,
    );
  });

  test("남의 태스크·없는 태스크는 수정·삭제 모두 같은 404다", async ({ request }) => {
    const task = await createTask(request, alice, { title: "alice만의 것", tagIds: [work.id] });
    const others = `${TASKS}/${task.id}`;
    const missing = `${TASKS}/${crypto.randomUUID()}`;

    for (const path of [others, missing, `${TASKS}/not-a-uuid`]) {
      await expectFailure(await request.patch(path, { ...as(bob), data: { status: "done" } }), "TASK_NOT_FOUND", 404);
      await expectFailure(await request.patch(path, { ...as(bob), data: { tagIds: [] } }), "TASK_NOT_FOUND", 404);
      await expectFailure(await request.delete(path, as(bob)), "TASK_NOT_FOUND", 404);
    }

    const a = await request.delete(others, as(bob));
    const b = await request.delete(missing, as(bob));
    expect(await bodyOf(a)).toEqual(await bodyOf(b));

    // bob의 시도가 아무것도 바꾸지 않았다.
    const intact = await dataOf<Task>(await request.get(others, as(alice)));
    expect(intact).toEqual(task);
  });

  test("삭제하면 { id }가 오고, 이후 조회는 404다", async ({ request }) => {
    const task = await createTask(request, alice, { title: "지울 것", tagIds: [work.id] });
    const path = `${TASKS}/${task.id}`;

    expect(await dataOf(await request.delete(path, as(alice)))).toEqual({ id: task.id });
    await expectFailure(await request.get(path, as(alice)), "TASK_NOT_FOUND", 404);
    await expectFailure(await request.delete(path, as(alice)), "TASK_NOT_FOUND", 404);

    // 태그는 남는다.
    const { data: tag } = await alice.client.from("tags").select("id").eq("id", work.id).maybeSingle();
    expect(tag).not.toBeNull();
  });
});
