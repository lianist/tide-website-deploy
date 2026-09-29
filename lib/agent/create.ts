import type { AuthContext } from "@/lib/api/auth";
import { recordJobLog } from "@/lib/api/job-logs";
import { analyzeImage } from "@/lib/llm";

import { buildCreatePrompt, buildCreateSchema, CREATE_SYSTEM, type CreateOutput } from "./create-prompt";
import { toDueAt } from "@/lib/time";

/**
 * 생성 캡처 에이전트 — `AGT-1`~`AGT-5`, `AGT-8`, `AGT-10`, `AGT-11`.
 *
 * 캡처 한 장 → LLM 한 번 → 작업 로그 한 행 → 태스크 N개. 이미 있는 미완료 태스크와 같은 일은
 * 만들지 않고 `duplicates`로 돌려준다 — 판정은 **같은 한 번의 호출** 안에서 한다(설계 결정 27). 반환 모양은 `POST /api/v1/captures`의
 * `data`(`docs/04-API-Contract.md` §캡처)와 같아서, 캡처 API(L-P0-10)는 이 함수를 감싸기만 한다.
 *
 * 여기서 하지 않는 것 — 10초 예산은 호출부가 `signal`로 건다(`AGT-9`). LLM 호출이 실패하면
 * `LlmError`가 그대로 올라가고, 그 실패의 작업 로그도 호출부가 쓴다(`LlmError.usage`를 들고 있다).
 */

const UNCATEGORIZED = "미분류";

export const NO_TASK_TO_CREATE = {
  code: "NO_TASK_TO_CREATE",
  message: "생성할 태스크가 없어요.",
} as const;

/** 미완료 후보 상한. 최근에 만든 것부터 싣는다 — 중복은 대개 최근 캡처끼리 생긴다(설계 결정 27). */
export const OPEN_TASK_LIMIT = 40;

/**
 * 할 일이 **전부** 이미 있을 때(`AGT-11`). 알림 본문이 곧 `message`라 기존 태스크 제목을 싣는다 —
 * "이미 있다"만으로는 무엇이 있는지 알 수 없다. `code`는 상수, `message`는 요청마다 만든다.
 */
export const DUPLICATE_TASK_CODE = "DUPLICATE_TASK";

export function duplicateFailure(duplicates: ExistingTask[]) {
  const [first, ...rest] = duplicates;
  const more = rest.length > 0 ? ` 외 ${rest.length}건` : "";
  return { code: DUPLICATE_TASK_CODE, message: `이미 있는 태스크예요: ${first!.title}${more}` } as const;
}

/** 같은 일로 판정된 기존 미완료 태스크. 응답의 `duplicates[]` 한 칸이다. */
export interface ExistingTask {
  id: string;
  title: string;
}

export type CreateFailure = typeof NO_TASK_TO_CREATE | ReturnType<typeof duplicateFailure>;

export interface CreateAgentInput {
  /** 캡처 원본. 이 호출 안에서만 쓰이고 어디에도 남지 않는다(`AGT-10`). */
  image: { bytes: Uint8Array; mimeType: string };
  /** ISO 8601. 상대 날짜 환산의 기준(`AGT-4`). */
  capturedAt: string;
  /** IANA 시간대. 호출부가 검증해서 넘긴다. */
  timezone: string;
  signal?: AbortSignal;
}

export interface CreatedTask {
  id: string;
  title: string;
  dueAt: string | null;
  dueHasTime: boolean;
  tags: string[];
  rationale: string;
}

export interface CreateAgentResult {
  jobLogId: string;
  outcome: "created" | "failed";
  created: CreatedTask[];
  completed: null;
  /** 이미 있어서 만들지 않은 것. **항상 있다**(없으면 `[]`) — 앱이 분기를 하나만 쓰게. */
  duplicates: ExistingTask[];
  failure: CreateFailure | null;
}

type Ctx = Pick<AuthContext, "supabase" | "userId">;

/**
 * 사용자의 태그 이름 → id. **호출마다 새로 읽는다**(`DASH-6`) — 방금 합치거나 이름을 바꾼 목록이
 * 그대로 다음 캡처의 프롬프트에 실린다. 캐시를 두면 사용자가 정리한 태그를 에이전트가 한동안
 * 모르게 되고, 그것이 요구사항이 금지하는 것이다.
 *
 * `runCreateAgent` 안에 인라인이던 것을 `L-P1-06`에서 꺼냈다. 동작은 그대로이고, 얻은 것은
 * **테스트가 프로덕션의 읽기를 복제하지 않고 가로챌 이음매**다 — 이것이 없으면 "프롬프트의 목록이
 * DB와 같다"를 검증한다면서 테스트가 자기 질의를 한 벌 더 쓰게 된다.
 */
export async function loadTagIds(ctx: Ctx): Promise<Map<string, string>> {
  const { data, error } = await ctx.supabase.from("tags").select("id, name");
  if (error) throw error;
  return new Map(data.map((tag) => [tag.name, tag.id]));
}

/** 중복 후보 — 최근에 만든 미완료 태스크 `OPEN_TASK_LIMIT`건. `loadTagIds`처럼 호출마다 새로 읽는다. */
export async function loadOpenTasks(ctx: Ctx): Promise<ExistingTask[]> {
  const { data, error } = await ctx.supabase
    .from("tasks")
    .select("id, title")
    .eq("status", "todo")
    .order("created_at", { ascending: false })
    .limit(OPEN_TASK_LIMIT);
  if (error) throw error;
  return data;
}

export interface CreatePlan {
  toCreate: CreateOutput["tasks"];
  duplicates: ExistingTask[];
  failure: CreateFailure | null;
}

/**
 * 모델 출력 → 무엇을 만들고 무엇을 돌려줄지. **DB도 LLM도 건드리지 않는 순수 함수**라 세 분기
 * (전부 중복·일부 중복·중복 없음)를 테스트가 결정적으로 밟는다(`runCapture`를 라우트 밖으로 뺀
 * 설계 결정 17의 선례).
 *
 * `candidates`에 없는 번호는 중복이 아닌 것으로 친다. 스키마 enum이 막아 실제로는 오지 않지만,
 * 온다면 할 일을 잃는 쪽보다 하나 더 만드는 쪽이 낫다 — 프롬프트 8번과 같은 비대칭이다.
 */
export function planCreate(output: CreateOutput, candidates: Map<string, ExistingTask>): CreatePlan {
  const tasks = output.tasks.filter((task) => task.title.trim());

  const toCreate: CreateOutput["tasks"] = [];
  const duplicates = new Map<string, ExistingTask>();
  for (const task of tasks) {
    const existing = task.duplicateOfKey === null ? undefined : candidates.get(task.duplicateOfKey);
    if (!existing) {
      toCreate.push(task);
      continue;
    }
    // 두 태스크가 같은 기존 태스크를 가리키면 한 번만 싣는다 — 알림의 "외 N건"이 부풀지 않게.
    duplicates.set(existing.id, existing);
  }

  const found = [...duplicates.values()];
  if (tasks.length === 0) return { toCreate, duplicates: found, failure: NO_TASK_TO_CREATE };
  if (toCreate.length === 0) return { toCreate, duplicates: found, failure: duplicateFailure(found) };
  return { toCreate, duplicates: found, failure: null };
}

export async function runCreateAgent(ctx: Ctx, input: CreateAgentInput): Promise<CreateAgentResult> {
  const { supabase } = ctx;

  // 두 읽기를 겹친다 — 10초 예산(`AGT-9`)에 왕복이 하나 더 붙지 않게.
  const [tagIds, openTasks] = await Promise.all([loadTagIds(ctx), loadOpenTasks(ctx)]);

  // 번호는 이 요청 안에서만 쓴다. 모델은 번호만 보고, id는 서버가 쥔다(완료 에이전트와 같다).
  const candidates = new Map(openTasks.map((task, i) => [String(i + 1), task]));

  const { output, usage } = await analyzeImage<CreateOutput>({
    system: CREATE_SYSTEM,
    prompt: buildCreatePrompt({
      capturedAt: input.capturedAt,
      timezone: input.timezone,
      existingTags: [...tagIds.keys()],
      openTasks: [...candidates].map(([key, task]) => ({ key, title: task.title })),
    }),
    image: input.image,
    schema: buildCreateSchema([...candidates.keys()]),
    signal: input.signal,
  });

  const { toCreate, duplicates, failure } = planCreate(output, candidates);

  // 태스크보다 로그가 먼저다 — 태스크가 `job_log_id`로 이 행을 가리킨다.
  //
  // 전부 중복이어도 `rationale`을 쓰지 않는다. 계약이 그 칸을 "완료 처리에서만 찬다"고 적어 두었고
  // (`public/api.md` §작업 로그), 그 문서는 추가만 한다. 무엇과 겹쳤는지는 응답의 `duplicates`가 나른다.
  const jobLogId = await recordJobLog(ctx, {
    source: "capture_create",
    outcome: failure ? "failed" : "created",
    failureReason: failure?.code ?? null,
    captureSummary: output.summary.trim() || null,
    usage,
  });

  // 태스크를 하나씩 만든다. 도중에 실패하면 앞의 것은 남는다(여러 태스크를 한 트랜잭션으로 묶지 않았다).
  // 실패는 예외로 올라가고 호출부가 500으로 알린다. 로그는 이미 created로 적혀 있다.
  const created: CreatedTask[] = [];
  for (const task of toCreate) {
    const tagNames = await resolveTags(ctx, tagIds, task.tags);
    const dueAt = task.dueDate ? toDueAt(task.dueDate, task.dueTime, input.timezone) : null;
    const dueHasTime = dueAt !== null && task.dueTime !== null;
    const title = task.title.trim();
    const rationale = task.rationale.trim();

    const { data: id, error } = await supabase.rpc("create_task", {
      p_title: title,
      p_description: task.description?.trim() || undefined,
      p_due_at: dueAt ?? undefined,
      p_due_has_time: dueHasTime,
      p_tag_ids: tagNames.map((name) => tagIds.get(name)!),
      p_source: "capture_create",
      p_rationale: rationale,
      p_job_log_id: jobLogId,
    });
    if (error) throw error;

    created.push({ id, title, dueAt, dueHasTime, tags: tagNames, rationale });
  }

  return { jobLogId, outcome: failure ? "failed" : "created", created, completed: null, duplicates, failure };
}

/**
 * 모델이 고른 태그 이름을 실제 태그로 만든다(`AGT-5`). 기존 이름이면 그대로 쓰고, 없는 이름이면
 * 새로 만든다 — 새 태그를 만들지 말지는 프롬프트가 판단했다. 아무것도 남지 않으면 '미분류'.
 * 새로 만든 태그는 `tagIds`에 넣어 같은 캡처의 다음 태스크가 다시 만들지 않게 한다.
 */
async function resolveTags(ctx: Ctx, tagIds: Map<string, string>, names: string[]): Promise<string[]> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (wanted.length === 0) wanted.push(UNCATEGORIZED);

  for (const name of wanted) {
    if (tagIds.has(name)) continue;
    const { data, error } = await ctx.supabase
      .from("tags")
      .insert({ user_id: ctx.userId, name })
      .select("id")
      .single();
    if (error) throw error;
    tagIds.set(name, data.id);
  }
  return wanted;
}
