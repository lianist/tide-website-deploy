import { expect, test } from "@playwright/test";

import { runCompleteAgent } from "@/lib/agent/complete";

import { createAdminClient, createSignedInUser, deleteUser } from "../support/supabase";
import { type BaseCase, loadCases, readCaptureImage, type SeedTask, seedTags, seedTasks } from "./support";

/**
 * 완료 캡처 평가 세트 실행기 — `L-P0-09`. 데이터와 비교 규칙은 `e2e/fixtures/captures/README.md`.
 *
 * 케이스마다 새 사용자에게 `existingTags`와 `seedTasks`를 심고, 에이전트를 **실제 LLM으로** 돌린 뒤
 * DB에 남은 상태로 판정한다 — 몇 개가 `done`이 됐나, 그게 허용된 것인가, 나머지는 `todo`로 남았나.
 * 닫힌 태스크는 우리가 심은 제목이라 문구를 정확히 비교한다.
 *
 * `npm run grade -- complete` — 게이트는 `--repeat-each=3`으로 3회 연속 전부 통과다(ROADMAP L-P0-09).
 */
test.describe.configure({ mode: "parallel" });

interface Case extends BaseCase {
  seedTasks: SeedTask[];
  expect: {
    outcome: "completed" | "failed";
    failureCode: string | null;
    completedCount: number;
    completedOneOf: string[];
    unchangedCount: number;
  };
}

for (const c of loadCases<Case>("e2e/fixtures/captures/complete")) {
  test(c.name, async () => {
    test.setTimeout(60_000);
    const admin = createAdminClient();
    const user = await createSignedInUser(admin);

    try {
      const tagIds = await seedTags(user, c.existingTags);
      await seedTasks(user, tagIds, c.seedTasks, c.timezone);

      const result = await runCompleteAgent(
        { supabase: user.client, userId: user.user.id },
        { image: await readCaptureImage(c.folder, c.image), capturedAt: c.capturedAt, timezone: c.timezone },
      );

      // 판정은 반환값이 아니라 **DB에 남은 것**으로 한다. 사용자가 보게 되는 것이 그것이다.
      const [{ data: rows }, { data: log }] = await Promise.all([
        user.client.from("tasks").select("title, status"),
        user.client
          .from("job_logs")
          .select("source, outcome, failure_reason, capture_summary, latency_ms, prompt_tokens, completion_tokens")
          .eq("id", result.jobLogId)
          .single(),
      ]);
      const done = (rows ?? []).filter((row) => row.status === "done").map((row) => row.title);
      const todo = (rows ?? []).filter((row) => row.status === "todo");

      // 실패하면 무엇이 닫혔는지부터 봐야 프롬프트를 고칠 수 있다.
      console.log(
        `[grade] ${c.name}`,
        JSON.stringify({
          latencyMs: log?.latency_ms,
          tokens: [log?.prompt_tokens, log?.completion_tokens],
          summary: log?.capture_summary,
          done,
        }),
      );

      expect(log?.source, "작업 로그 소스").toBe("capture_complete");
      expect(log?.outcome, "작업 로그 결말").toBe(c.expect.outcome);
      expect(log?.failure_reason ?? null, "실패 코드").toBe(c.expect.failureCode);
      expect(log?.capture_summary?.trim(), "요약(AGT-8)").toBeTruthy();

      expect(done, `done 개수 ${c.expect.completedCount}`).toHaveLength(c.expect.completedCount);
      for (const title of done) expect(c.expect.completedOneOf, "닫힌 태스크가 허용 목록에").toContain(title);
      expect(todo, `todo로 남은 개수 ${c.expect.unchangedCount}`).toHaveLength(c.expect.unchangedCount);

      // 반환값이 DB와 같은지 — 캡처 API는 이 반환값을 그대로 앱에 보낸다.
      expect(result.completed?.title ?? null).toBe(done[0] ?? null);
      expect(result.failure?.code ?? null).toBe(c.expect.failureCode);
    } finally {
      await deleteUser(admin, user.user.id);
    }
  });
}
