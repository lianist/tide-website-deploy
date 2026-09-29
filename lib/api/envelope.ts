/**
 * API 응답 봉투 — `docs/04-API-Contract.md` §응답 봉투의 구현.
 *
 * 성공은 `{ data }`, 실패는 `{ error: { code, message } }` 두 모양뿐이다. 앱이 분기를
 * 하나만 쓰게 하려는 것이므로(`docs/03-Architecture.md` §설계 결정 5) Route Handler가
 * `Response.json()`을 직접 부르지 않고 항상 이 두 함수를 지난다.
 */

/**
 * 기계가 읽는 실패 코드. 계약 문서 §공통 에러 코드 표와 1:1이다.
 *
 * `NO_TASK_TO_CREATE`·`NO_TASK_TO_COMPLETE`는 여기 없다 — 에이전트가 정상 동작한 결과라
 * `error`가 아니라 `data.failure`로 나가야 하기 때문이다(`AGT-3`, `AGT-7`). 이 표에 넣으면
 * 실수로 실패 봉투에 실릴 수 있다.
 *
 * `JOB_LOG_NOT_FOUND`는 `TASK_NOT_FOUND`를 재사용하지 않는다(`L-P1-02`). 코드는 기계가 읽는
 * 값이고, 작업 로그가 없는 것을 "태스크가 없다"로 알리면 앱의 분기를 속인다.
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "CONSENT_REQUIRED"
  | "VALIDATION_FAILED"
  | "TASK_NOT_FOUND"
  | "TAG_NOT_FOUND"
  | "JOB_LOG_NOT_FOUND"
  | "TAG_NAME_TAKEN"
  | "TAG_PROTECTED"
  | "REVERT_NOT_POSSIBLE"
  | "AGENT_TIMEOUT"
  | "INTERNAL_ERROR";

/**
 * 코드마다 HTTP 상태가 하나로 정해져 있다. 호출부가 상태를 고르지 못하게 해서
 * "404를 뜻하는데 403을 보냈다" 같은 어긋남이 생길 자리를 없앤다.
 */
const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  // 누군지는 확인됐지만 개인정보처리방침에 아직 동의하지 않았다(HF-06). 남의 자원(404)과 달리
  // 숨길 것이 없으므로 403이다.
  CONSENT_REQUIRED: 403,
  VALIDATION_FAILED: 400,
  TASK_NOT_FOUND: 404,
  TAG_NOT_FOUND: 404,
  JOB_LOG_NOT_FOUND: 404,
  TAG_NAME_TAKEN: 409,
  TAG_PROTECTED: 409,
  REVERT_NOT_POSSIBLE: 409,
  AGENT_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

/** 성공 응답. `data`에 담기는 것은 카멜케이스로 변환된 뒤여야 한다. */
export function ok<T>(data: T): Response {
  return Response.json({ data });
}

/**
 * 실패 응답. `message`는 사람이 읽는 한국어 문장이고 앱이 알림 본문에 그대로 쓴다(`NTF-1`).
 * 그래서 "Invalid request" 같은 개발자용 문구를 넣지 않는다.
 */
export function fail(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: HTTP_STATUS[code] });
}
