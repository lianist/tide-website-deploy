import { expect, test, type APIRequestContext } from "@playwright/test";

import { bearer, bodyOf, dataOf, expectFailure } from "./support/api";
import {
  createAdminClient,
  createSignedInUser,
  deleteUser,
  type DochiClient,
  type TestUser,
} from "./support/supabase";

/**
 * L-P0-06 검증 — 태그 CRUD(`API-2`). 병합(`DASH-6`)은 아래 둘째 블록에 있다.
 *
 * 태스크와 다른 점 둘: 이름이 사용자마다 유일하고(`409 TAG_NAME_TAKEN`), '미분류'는
 * 바꾸거나 지울 수 없다(`409 TAG_PROTECTED` — `AGT-5`의 전제).
 */
test.describe.configure({ mode: "serial" });

const TAGS = "/api/v1/tags";

interface Tag {
  id: string;
  name: string;
  createdAt: string;
}

/* ── 병합 블록이 쓰는 헬퍼. 전부 공개 API만 지나 실제 사용자와 같은 길을 걷는다. ── */

const headersFor = (user: TestUser) => ({ headers: bearer(user.accessToken) });

async function makeTag(request: APIRequestContext, user: TestUser, name: string): Promise<Tag> {
  return dataOf<Tag>(await request.post(TAGS, { ...headersFor(user), data: { name } }));
}

async function makeTask(
  request: APIRequestContext,
  user: TestUser,
  title: string,
  tagIds: string[],
): Promise<{ id: string }> {
  return dataOf<{ id: string }>(
    await request.post("/api/v1/tasks", { ...headersFor(user), data: { title, tagIds } }),
  );
}

async function tagList(request: APIRequestContext, user: TestUser): Promise<Tag[]> {
  return dataOf<Tag[]>(await request.get(TAGS, headersFor(user)));
}

/** 목록에서 매번 새로 찾는다 — 병합이 목록을 바꾸므로 모듈 변수에 붙들어 두지 않는다. */
async function uncategorizedOf(request: APIRequestContext, user: TestUser): Promise<Tag> {
  const found = (await tagList(request, user)).find((tag) => tag.name === "미분류");
  expect(found, "가입 트리거가 만드는 '미분류'가 보이지 않는다").toBeDefined();
  return found!;
}

async function taskTagIds(request: APIRequestContext, user: TestUser, taskId: string): Promise<string[]> {
  const task = await dataOf<{ tags: { id: string }[] }>(
    await request.get(`/api/v1/tasks/${taskId}`, headersFor(user)),
  );
  return task.tags.map((tag) => tag.id);
}

test.describe("태그 CRUD", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;
  let uncategorized: Tag;

  const as = (user: TestUser) => ({ headers: bearer(user.accessToken) });

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    for (const user of [alice, bob]) {
      if (!user) continue;
      await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    }
  });

  test("토큰이 없으면 401이다", async ({ request }) => {
    const path = `${TAGS}/${crypto.randomUUID()}`;
    await expectFailure(await request.get(TAGS), "UNAUTHORIZED", 401);
    await expectFailure(await request.post(TAGS, { data: { name: "x" } }), "UNAUTHORIZED", 401);
    await expectFailure(await request.patch(path, { data: { name: "x" } }), "UNAUTHORIZED", 401);
    await expectFailure(await request.delete(path), "UNAUTHORIZED", 401);
  });

  test("새 계정의 목록에는 '미분류' 하나만 있다", async ({ request }) => {
    const list = await dataOf<Tag[]>(await request.get(TAGS, as(alice)));

    expect(list.map((tag) => tag.name)).toEqual(["미분류"]);
    expect(Object.keys(list[0]!).sort()).toEqual(["createdAt", "id", "name"]);
    uncategorized = list[0]!;
  });

  test("생성하면 목록에 이름순으로 나타난다", async ({ request }) => {
    const created = await dataOf<Tag>(await request.post(TAGS, { ...as(alice), data: { name: "  가계부 " } }));
    expect(created.name).toBe("가계부");

    const list = await dataOf<Tag[]>(await request.get(TAGS, as(alice)));
    expect(list.map((tag) => tag.name)).toEqual(["가계부", "미분류"]);

    // bob에게는 보이지 않는다.
    const bobs = await dataOf<Tag[]>(await request.get(TAGS, as(bob)));
    expect(bobs.map((tag) => tag.name)).toEqual(["미분류"]);
  });

  test("같은 이름은 409 TAG_NAME_TAKEN — '미분류'도 마찬가지", async ({ request }) => {
    for (const name of ["가계부", "미분류"]) {
      await expectFailure(await request.post(TAGS, { ...as(alice), data: { name } }), "TAG_NAME_TAKEN", 409);
    }
    // 이름 유일성은 사용자별이다 — bob은 같은 이름을 쓸 수 있다.
    await dataOf(await request.post(TAGS, { ...as(bob), data: { name: "가계부" } }));
  });

  test("이름이 비었거나 형식이 틀리면 400이다", async ({ request }) => {
    for (const data of [{}, { name: " " }, { name: 3 }]) {
      await expectFailure(await request.post(TAGS, { ...as(alice), data }), "VALIDATION_FAILED", 400);
    }
    const tag = await dataOf<Tag>(await request.post(TAGS, { ...as(alice), data: { name: "검증용" } }));
    await expectFailure(await request.patch(`${TAGS}/${tag.id}`, { ...as(alice), data: {} }), "VALIDATION_FAILED", 400);
  });

  test("이름을 바꾸고, 겹치는 이름으로는 못 바꾼다", async ({ request }) => {
    const tag = await dataOf<Tag>(await request.post(TAGS, { ...as(alice), data: { name: "운동" } }));
    const path = `${TAGS}/${tag.id}`;

    const renamed = await dataOf<Tag>(await request.patch(path, { ...as(alice), data: { name: "헬스" } }));
    expect(renamed).toEqual({ ...tag, name: "헬스" });

    for (const name of ["가계부", "미분류"]) {
      await expectFailure(await request.patch(path, { ...as(alice), data: { name } }), "TAG_NAME_TAKEN", 409);
    }
  });

  test("'미분류'는 이름을 바꾸거나 지울 수 없다 — 409 TAG_PROTECTED", async ({ request }) => {
    const path = `${TAGS}/${uncategorized.id}`;

    await expectFailure(await request.patch(path, { ...as(alice), data: { name: "기타" } }), "TAG_PROTECTED", 409);
    await expectFailure(await request.delete(path, as(alice)), "TAG_PROTECTED", 409);

    const list = await dataOf<Tag[]>(await request.get(TAGS, as(alice)));
    expect(list.find((tag) => tag.id === uncategorized.id)?.name).toBe("미분류");
  });

  test("남의 태그·없는 태그·UUID 아닌 id는 404다 — 남의 '미분류'도 보호가 아니라 404", async ({ request }) => {
    const alicesTag = await dataOf<Tag>(await request.post(TAGS, { ...as(alice), data: { name: "alice 전용" } }));

    // 남의 '미분류'에 TAG_PROTECTED를 내면 그 id가 실재한다는 것을 흘린다.
    for (const id of [alicesTag.id, uncategorized.id, crypto.randomUUID(), "not-a-uuid"]) {
      const path = `${TAGS}/${id}`;
      await expectFailure(await request.patch(path, { ...as(bob), data: { name: "뺏기" } }), "TAG_NOT_FOUND", 404);
      await expectFailure(await request.delete(path, as(bob)), "TAG_NOT_FOUND", 404);
    }

    const list = await dataOf<Tag[]>(await request.get(TAGS, as(alice)));
    expect(list.find((tag) => tag.id === alicesTag.id)?.name).toBe("alice 전용");
  });

  test("태그를 지우면 태스크에서 떨어지고 태스크는 남는다", async ({ request }) => {
    const tag = await dataOf<Tag>(await request.post(TAGS, { ...as(alice), data: { name: "곧 사라짐" } }));
    const task = await dataOf<{ id: string; tags: { id: string }[] }>(
      await request.post("/api/v1/tasks", {
        ...as(alice),
        data: { title: "태그를 잃을 태스크", tagIds: [tag.id, uncategorized.id] },
      }),
    );
    expect(task.tags).toHaveLength(2);

    expect(await dataOf(await request.delete(`${TAGS}/${tag.id}`, as(alice)))).toEqual({ id: tag.id });
    await expectFailure(await request.delete(`${TAGS}/${tag.id}`, as(alice)), "TAG_NOT_FOUND", 404);

    const after = await dataOf<{ tags: { id: string }[] }>(await request.get(`/api/v1/tasks/${task.id}`, as(alice)));
    expect(after.tags.map((t) => t.id)).toEqual([uncategorized.id]);
  });
});

/**
 * L-P1-05 검증 — 태그 병합(`DASH-6`, `API-6`).
 *
 * **테스트마다 자기 태그와 태스크를 심는다.** 병합은 출발 태그를 없애는 파괴적 동작이라 공유
 * 상태를 두면 앞 테스트가 뒷 테스트의 데이터를 지운다. 위 블록이 `uncategorized`를 공유하는 것과
 * 반대이고, `e2e/job-logs.spec.ts`의 되돌리기 블록이 세운 규율과 같다. 사용자도 따로 만든다.
 *
 * LLM을 부르지 않는다 — 판정이 전부 DB 함수에 있어 태그를 심는 것만으로 모든 갈래가 결정적이다.
 */
test.describe("태그 병합", () => {
  let admin: DochiClient;
  let carol: TestUser;
  let dave: TestUser;

  const as = headersFor;
  const MERGE = `${TAGS}/merge`;

  test.beforeAll(async () => {
    admin = createAdminClient();
    carol = await createSignedInUser(admin);
    dave = await createSignedInUser(admin);
  });

  test.afterAll(async () => {
    for (const user of [carol, dave]) {
      if (!user) continue;
      await deleteUser(admin, user.user.id).catch(() => undefined);
    }
  });

  test("토큰이 없으면 401이다 — 본문이 없어도 검증보다 인증이 먼저다", async ({ request }) => {
    await expectFailure(
      await request.post(MERGE, { data: { sourceId: crypto.randomUUID(), targetId: crypto.randomUUID() } }),
      "UNAUTHORIZED",
      401,
    );
    await expectFailure(await request.post(MERGE, { data: {} }), "UNAUTHORIZED", 401);
  });

  test("출발 태그의 태스크가 도착 태그로 옮겨지고, 도착 태그는 그대로다", async ({ request }) => {
    const source = await makeTag(request, carol, "옮겨질 태그");
    const target = await makeTag(request, carol, "남을 태그");
    const task = await makeTask(request, carol, "옮겨질 태스크", [source.id]);

    const merged = await dataOf<Tag>(
      await request.post(MERGE, { ...as(carol), data: { sourceId: source.id, targetId: target.id } }),
    );

    // 도착 태그를 새로 만들지 않는다 — id도 createdAt도 병합 전과 같다.
    expect(Object.keys(merged).sort()).toEqual(["createdAt", "id", "name"]);
    expect(merged).toEqual(target);

    expect(await taskTagIds(request, carol, task.id)).toEqual([target.id]);
  });

  test("양쪽에 달렸던 태스크도 도착 태그가 한 번만 남는다", async ({ request }) => {
    const source = await makeTag(request, carol, "중복 출발");
    const target = await makeTag(request, carol, "중복 도착");
    const both = await makeTask(request, carol, "둘 다 달린 태스크", [source.id, target.id]);
    const onlySource = await makeTask(request, carol, "출발만 달린 태스크", [source.id]);
    const onlyTarget = await makeTask(request, carol, "도착만 달린 태스크", [target.id]);

    await dataOf(await request.post(MERGE, { ...as(carol), data: { sourceId: source.id, targetId: target.id } }));

    for (const id of [both.id, onlySource.id, onlyTarget.id]) {
      expect(await taskTagIds(request, carol, id)).toEqual([target.id]);
    }

    // 필터로 읽어도 셋이 전부 온다 — 연결이 한 건도 새지 않았다.
    const filtered = await dataOf<{ id: string }[]>(
      await request.get(`/api/v1/tasks?tagId=${target.id}`, as(carol)),
    );
    expect(filtered.map((t) => t.id).sort()).toEqual([both.id, onlySource.id, onlyTarget.id].sort());
  });

  test("병합 뒤 출발 태그는 목록에서 사라지고, 다시 합치면 404다", async ({ request }) => {
    const source = await makeTag(request, carol, "사라질 태그");
    const target = await makeTag(request, carol, "살아남을 태그");
    const task = await makeTask(request, carol, "태그를 옮길 태스크", [source.id]);

    const data = { sourceId: source.id, targetId: target.id };
    await dataOf(await request.post(MERGE, { ...as(carol), data }));

    const names = (await tagList(request, carol)).map((tag) => tag.id);
    expect(names).not.toContain(source.id);
    expect(names).toContain(target.id);

    // 멱등이 아니다 — 출발 태그가 이미 없으므로 두 번째 호출은 404다.
    await expectFailure(await request.post(MERGE, { ...as(carol), data }), "TAG_NOT_FOUND", 404);
    await expectFailure(await request.delete(`${TAGS}/${source.id}`, as(carol)), "TAG_NOT_FOUND", 404);

    // 태스크는 한 건도 사라지지 않는다.
    expect(await taskTagIds(request, carol, task.id)).toEqual([target.id]);
  });

  test("'미분류'가 출발이면 409 TAG_PROTECTED이고 아무것도 옮겨지지 않는다", async ({ request }) => {
    const uncategorized = await uncategorizedOf(request, carol);
    const target = await makeTag(request, carol, "미분류를 받으려던 태그");
    const task = await makeTask(request, carol, "미분류가 달린 태스크", [uncategorized.id]);

    const body = await bodyOf(
      await request.post(MERGE, { ...as(carol), data: { sourceId: uncategorized.id, targetId: target.id } }),
    );
    expect(body).toEqual({
      error: { code: "TAG_PROTECTED", message: "'미분류' 태그는 바꾸거나 지울 수 없습니다." },
    });

    // '미분류'가 그대로 있고, 태스크의 태그도 움직이지 않았다.
    expect((await tagList(request, carol)).map((tag) => tag.id)).toContain(uncategorized.id);
    expect(await taskTagIds(request, carol, task.id)).toEqual([uncategorized.id]);
  });

  test("'미분류'가 도착인 병합은 된다 — 보호는 출발에만 걸린다", async ({ request }) => {
    const uncategorized = await uncategorizedOf(request, dave);
    const source = await makeTag(request, dave, "미분류로 되돌릴 태그");
    const task = await makeTask(request, dave, "미분류로 갈 태스크", [source.id]);

    const merged = await dataOf<Tag>(
      await request.post(MERGE, { ...as(dave), data: { sourceId: source.id, targetId: uncategorized.id } }),
    );
    expect(merged).toEqual(uncategorized);

    expect(await taskTagIds(request, dave, task.id)).toEqual([uncategorized.id]);
    expect((await tagList(request, dave)).map((tag) => tag.name)).toEqual(["미분류"]);
  });

  test("남의 태그·없는 태그는 404다 — 남의 '미분류'도 보호가 아니라 404", async ({ request }) => {
    const carolsTag = await makeTag(request, carol, "carol 전용");
    const carolsUncategorized = await uncategorizedOf(request, carol);
    const carolsTask = await makeTask(request, carol, "carol의 태스크", [carolsTag.id]);
    const davesTag = await makeTag(request, dave, "dave 전용");
    const missing = crypto.randomUUID();

    // 남의 태그가 출발이든 도착이든 같은 404다. 남의 '미분류'에 TAG_PROTECTED를 내면 그 id가
    // 실재한다는 것을 흘린다 — RLS가 그것을 자동으로 막는다는 사실을 여기서 고정한다.
    const pairs = [
      { sourceId: carolsTag.id, targetId: davesTag.id },
      { sourceId: davesTag.id, targetId: carolsTag.id },
      { sourceId: carolsUncategorized.id, targetId: davesTag.id },
      { sourceId: davesTag.id, targetId: carolsUncategorized.id },
      { sourceId: missing, targetId: davesTag.id },
      { sourceId: davesTag.id, targetId: missing },
    ];
    for (const data of pairs) {
      await expectFailure(await request.post(MERGE, { ...as(dave), data }), "TAG_NOT_FOUND", 404);
    }

    // carol의 것은 하나도 움직이지 않았다.
    const carols = (await tagList(request, carol)).map((tag) => tag.id);
    expect(carols).toEqual(expect.arrayContaining([carolsTag.id, carolsUncategorized.id]));
    expect(await taskTagIds(request, carol, carolsTask.id)).toEqual([carolsTag.id]);
  });

  test("같은 id 둘·빠진 id·UUID 아닌 id는 400이다", async ({ request }) => {
    const tag = await makeTag(request, carol, "400을 받을 태그");

    const bodies = [
      { sourceId: tag.id, targetId: tag.id },
      {},
      { sourceId: tag.id },
      { sourceId: tag.id, targetId: "not-a-uuid" },
      { sourceId: 3, targetId: tag.id },
    ];
    for (const data of bodies) {
      await expectFailure(await request.post(MERGE, { ...as(carol), data }), "VALIDATION_FAILED", 400);
    }

    // 400인데 지워지지 않았다.
    expect((await tagList(request, carol)).map((t) => t.id)).toContain(tag.id);
  });
});
