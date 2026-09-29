/**
 * LLM 어댑터의 프로바이더 중립 타입 — `docs/03-Architecture.md` §설계 결정 4.
 *
 * 여기에는 OpenAI 고유의 이름이 하나도 없어야 한다. 호출부(에이전트, 캡처 API)는 이 타입만 알고,
 * 프로바이더를 바꿀 때는 `index.ts`의 한 줄과 구현 파일만 갈아 끼운다.
 */

/** 호출 한 번의 계측값. `job_logs`의 네 칸과 1:1이다(`recordJobLog`가 그대로 옮겨 적는다). */
export interface LlmUsage {
  /** 프로바이더가 **응답에 적어 보낸** 모델 ID. 요청한 별칭이 아니라 실제로 돈 스냅샷이다. */
  model: string;
  /** 응답을 받지 못한 실패(중단·네트워크)에서는 알 수 없으므로 null이다. */
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

export interface AnalyzeImageRequest {
  /** 역할과 규칙. 프롬프트 작성은 `docs/07-Prompt-Principles.md`를 따른다. */
  system: string;
  /** 이미지와 함께 실리는 사용자 메시지(맥락·질의). */
  prompt: string;
  /**
   * 캡처 원본. 요청 한 번에만 실리고 어디에도 남지 않는다(`AGT-10`) — 어댑터는 이 바이트를
   * 로그에도 에러 메시지에도 싣지 않는다.
   */
  image: { bytes: Uint8Array; mimeType: string };
  /**
   * 출력은 자유 텍스트가 아니라 이 JSON Schema로 **강제**된다. 스키마에 없는 칸은 모델이
   * 만들어 낼 수 없으므로 "신뢰도 필드를 두지 않는다"(결정 기록 2)가 여기서 지켜진다.
   */
  schema: { name: string; jsonSchema: Record<string, unknown> };
  /** 10초 예산(`AGT-9`)은 호출부가 정한다. 어댑터는 재시도하지 않고 이 신호만 따른다. */
  signal?: AbortSignal;
}

export interface AnalyzeImageResult<T> {
  output: T;
  usage: LlmUsage;
}

/**
 * 어댑터가 던지는 유일한 에러. 실패해도 계측은 남아야 하므로(`AGT-8`) usage를 들고 나온다 —
 * 호출부는 성공이든 실패든 `usage`를 `recordJobLog`에 넘기면 된다.
 */
export class LlmError extends Error {
  readonly usage: LlmUsage;
  /** 호출부가 신호로 끊은 경우. 캡처 API가 `AGENT_TIMEOUT`으로 옮기는 근거다. */
  readonly aborted: boolean;

  constructor(
    message: string,
    usage: LlmUsage,
    options: { aborted?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.usage = usage;
    this.aborted = options.aborted ?? false;
  }
}
