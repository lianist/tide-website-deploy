import type { AuthContext } from "@/lib/api/auth";
import { recordJobLog } from "@/lib/api/job-logs";
import { analyzeImage } from "@/lib/llm";

import type { CreateAgentInput } from "./create";
import { buildCompletePrompt, buildCompleteSchema, COMPLETE_SYSTEM, type CompleteOutput } from "./complete-prompt";

/**
 * 완료 캡처 에이전트 — `AGT-6`, `AGT-7`, `AGT-8`, `AGT-10`.
 *
 * 캡처 한 장 → 미완료 태스크 목록과 함께 LLM 한 번 → 태스크 하나를 `done`으로 → 작업 로그 한 행.
 * 반환 모양은 `POST /api/v1/captures`의 `data`(`docs/04-API-Contract.md` §캡처)와 같아서, 캡처 API
 * (L-P0-10)는 `runCreateAgent`와 이 함수를 `mode`로 고르기만 한다.
 *
 * 여기서 하지 않는 것 — 생성과 같다. 10초 예산은 호출부가 `signal`로 걸고(`AGT-9`), LLM 호출이
 * 실패하면 `LlmError`가 그대로 올라가 그 실패의 작업 로그도 호출부가 쓴다.
 *
 * **닫은 태스크와 그 근거를 남긴다**(`L-P1-01`). 되돌리기(`HIST-3`)가 이 연결을 읽는다. 로그를 쓴
 * **뒤에** 연결 칸을 따로 채우는 이유는 결정 16에 있다 — 태스크가 로그를 가리키므로 로그가 먼저
 * 있어야 하는데, `outcome`은 태스크를 닫아 봐야 정해지기 때문이다.
 */

export const NO_TASK_TO_COMPLETE = {
  code: "NO_TASK_TO_COMPLETE",
  message: "완료할 태스크를 찾지 못했어요.",
} as const;

export type CompleteAgentInput = CreateAgentInput;

export interface CompleteAgentResult {
  jobLogId: string;
  outcome: "completed" | "failed";
  created: [];
  completed: { id: string; title: string } | null;
  /** 생성 응답과 모양을 맞춘다 — 완료는 중복을 판정하지 않으므로 늘 비어 있다. */
  duplicates: [];
  failure: typeof NO_TASK_TO_COMPLETE | null;
}

type Ctx = Pick<AuthContext, "supabase" | "userId">;

export async function runCompleteAgent(ctx: Ctx, input: CompleteAgentInput): Promise<CompleteAgentResult> {
  const { supabase } = ctx;

  const { data: rows, error: readError } = await supabase
    .from("tasks")
    .select("id, title, due_at, due_has_time, task_tags(tags(name))")
    .eq("status", "todo")
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (readError) throw readError;

  // 번호는 이 요청 안에서만 쓴다. 모델은 번호만 보고, id는 서버가 쥔다.
  const ids = new Map(rows.map((row, i) => [String(i + 1), row.id]));
  const candidates = rows.map((row, i) => ({
    key: String(i + 1),
    title: row.title,
    dueAt: row.due_at,
    dueHasTime: row.due_has_time,
    tags: row.task_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])),
  }));

  // 후보가 없어도 부른다 — 실패여도 캡처 요약을 남겨야 한다(`AGT-8`).
  const { output, usage } = await analyzeImage<CompleteOutput>({
    system: COMPLETE_SYSTEM,
    prompt: buildCompletePrompt({ capturedAt: input.capturedAt, timezone: input.timezone, candidates }),
    image: input.image,
    schema: buildCompleteSchema([...ids.keys()]),
    signal: input.signal,
  });

  let completed: CompleteAgentResult["completed"] = null;
  const id = output.taskKey === null ? undefined : ids.get(output.taskKey);
  if (id) {
    // `status = 'todo'` 조건을 다시 건다. 목록을 읽은 뒤 사용자가 먼저 닫았다면 0행이고,
    // 그러면 이 캡처가 닫은 것은 없다 — 실패로 합류한다.
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "done" })
      .eq("id", id)
      .eq("status", "todo")
      .select("id, title")
      .maybeSingle();
    if (error) throw error;
    completed = data;
  }

  const failure = completed ? null : NO_TASK_TO_COMPLETE;

  // 반영한 **뒤에** 쓴다 — 로그가 실제 결과를 적는다. 낙관적으로 먼저 쓰면 update가 0행으로 끝났을 때
  // "완료했다"고 적힌 로그가 잠깐 존재하고, 그것을 정정하는 쓰기가 가장 흔한 실패 경로에 놓인다.
  const jobLogId = await recordJobLog(ctx, {
    source: "capture_complete",
    outcome: failure ? "failed" : "completed",
    failureReason: failure?.code ?? null,
    captureSummary: output.summary.trim() || null,
    // 닫을 것을 못 찾은 이유도 근거다 — 히스토리의 [직접 처리]가 읽는다.
    rationale: output.rationale.trim() || null,
    usage,
  });

  // 로그가 생긴 뒤에야 태스크가 그것을 가리킬 수 있다(FK). `status`를 다시 확인하지 않는다 —
  // 되돌리기의 판정 조건은 `revert_job_log`의 WHERE 하나이고, 같은 조건을 두 곳에 적지 않는다.
  if (completed) {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_by_job_log_id: jobLogId })
      .eq("id", completed.id);
    if (error) throw error;
  }

  return { jobLogId, outcome: failure ? "failed" : "completed", created: [], completed, duplicates: [], failure };
}
