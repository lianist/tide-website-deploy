import { expect, test } from "@playwright/test";

import { bearer, bodyOf, expectFailure } from "./support/api";
import { createAdminClient, createSignedInUser, type DochiClient, type TestUser } from "./support/supabase";

/**
 * L-P0-05 검증 — 모든 Route Handler가 같은 봉투와 같은 인증을 쓰는지 확인한다.
 *
 * 세 가지를 본다: 봉투가 `{data}` / `{error:{code,message}}` 두 모양뿐인지, 토큰이
 * 없거나 못 믿을 것이면 401인지, 그리고 **남의 자원이 403이 아니라 404인지**.
 */
test.describe.configure({ mode: "serial" });

const ME = "/api/v1/me";

/**
 * 실제 토큰의 `exp`만 과거로 바꾼다. 서명은 더 이상 맞지 않지만 auth-js의 `getClaims`가
 * 서명 검증보다 만료 검증을 먼저 돌리므로 이 토큰은 **만료 경로에서** 걸린다.
 * 서명키가 서버에만 있어 "서명까지 유효한 만료 토큰"은 테스트가 만들 수 없다.
 */
function expired(token: string): string {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  const stale = Buffer.from(JSON.stringify({ ...claims, exp: 1_000_000_000 })).toString(
    "base64url",
  );
  return `${header}.${stale}.${signature}`;
}

/** 만료되지 않았지만 서명이 맞지 않는 토큰. 이쪽은 서명 검증에서 걸린다. */
function forged(token: string): string {
  const [header, payload] = token.split(".");
  return `${header}.${payload}.${Buffer.from("forged-signature").toString("base64url")}`;
}

test.describe("API 봉투 · 인증", () => {
  let admin: DochiClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceTaskId: string;
  let aliceTaskPath: string;

  test.beforeAll(async () => {
    admin = createAdminClient();
    alice = await createSignedInUser(admin);
    bob = await createSignedInUser(admin);

    const { data: task, error } = await alice.client
      .from("tasks")
      .insert({
        user_id: alice.user.id,
        title: "alice의 태스크",
        source: "capture_create",
        rationale: "L-P0-05 검증용으로 직접 넣었다.",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceTaskId = task!.id;
    aliceTaskPath = `/api/v1/tasks/${aliceTaskId}`;
  });

  test.afterAll(async () => {
    for (const user of [alice, bob]) {
      if (!user) continue;
      await admin.auth.admin.deleteUser(user.user.id).catch(() => undefined);
    }
  });

  test("토큰이 없으면 401 UNAUTHORIZED다", async ({ request }) => {
    await expectFailure(await request.get(ME), "UNAUTHORIZED", 401);
    await expectFailure(await request.get(aliceTaskPath), "UNAUTHORIZED", 401);
  });

  test("Bearer 형식이 아니면 401이다", async ({ request }) => {
    const headers = { Authorization: alice.accessToken };

    await expectFailure(await request.get(ME, { headers }), "UNAUTHORIZED", 401);
  });

  test("만료된 토큰은 401이다", async ({ request }) => {
    const headers = bearer(expired(alice.accessToken));

    await expectFailure(await request.get(ME, { headers }), "UNAUTHORIZED", 401);
  });

  test("서명이 위조된 토큰은 401이다", async ({ request }) => {
    const headers = bearer(forged(alice.accessToken));

    await expectFailure(await request.get(ME, { headers }), "UNAUTHORIZED", 401);
  });

  test("유효한 토큰이면 /me가 내 계정을 돌려준다", async ({ request }) => {
    const response = await request.get(ME, { headers: bearer(alice.accessToken) });

    expect(response.status()).toBe(200);
    const body = await bodyOf(response);
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data).toEqual({ id: alice.user.id, email: alice.email });
  });

  test("내 태스크는 카멜케이스 본문으로 온다", async ({ request }) => {
    const response = await request.get(aliceTaskPath, { headers: bearer(alice.accessToken) });

    expect(response.status()).toBe(200);
    const body = await bodyOf(response);
    expect(Object.keys(body)).toEqual(["data"]);

    const task = body.data as Record<string, unknown>;
    expect(task.id).toBe(aliceTaskId);
    expect(task.title).toBe("alice의 태스크");
    expect(task.status).toBe("todo");
    expect(task.dueAt).toBeNull();
    expect(task.tags).toEqual([]);

    // 경계에서 변환이 실제로 일어났는지 — 스네이크케이스가 새어 나오면 안 된다.
    expect(Object.keys(task).sort()).toEqual(
      [
        "createdAt",
        "description",
        "dueAt",
        "dueHasTime",
        "id",
        "jobLogId",
        "rationale",
        "source",
        "status",
        "tags",
        "title",
        "updatedAt",
      ].sort(),
    );
    // 소유자는 내보내지 않는다.
    expect(task).not.toHaveProperty("userId");
    expect(task).not.toHaveProperty("user_id");
  });

  test("남의 태스크는 403이 아니라 404다", async ({ request }) => {
    const response = await request.get(aliceTaskPath, { headers: bearer(bob.accessToken) });

    await expectFailure(response, "TASK_NOT_FOUND", 404);
  });

  test("없는 태스크와 남의 태스크는 응답이 완전히 같다", async ({ request }) => {
    // 다르면 id를 넣어 보는 것만으로 남의 태스크가 실재하는지 알아낼 수 있다.
    const headers = bearer(bob.accessToken);

    const othersTask = await request.get(aliceTaskPath, { headers });
    const nonexistent = await request.get(`/api/v1/tasks/${crypto.randomUUID()}`, { headers });

    expect(othersTask.status()).toBe(nonexistent.status());
    expect(await bodyOf(othersTask)).toEqual(await bodyOf(nonexistent));
  });

  test("UUID 꼴이 아닌 id도 404로 합류한다", async ({ request }) => {
    const response = await request.get("/api/v1/tasks/not-a-uuid", {
      headers: bearer(alice.accessToken),
    });

    await expectFailure(response, "TASK_NOT_FOUND", 404);
  });
});
