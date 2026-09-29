/**
 * 인증 화면의 한국어 문구 — Supabase `AuthError.code`를 사람이 읽는 문장으로 옮긴다.
 *
 * **`actions.ts`와 같은 파일에 둘 수 없다.** `'use server'` 파일은 모든 export가 async 함수여야
 * 해서, 상수를 내보내면 빌드가 깨진다.
 *
 * `lib/api/envelope.ts`의 메시지와 역할이 다르다 — 저쪽은 앱이 알림 본문에 그대로 쓰는 문장이고,
 * 이쪽은 브라우저 폼 아래에 붙는 문장이다.
 */

/**
 * **계정의 존재 여부를 흘리지 않는다.** 로그인 실패는 이메일이 틀렸는지 비밀번호가 틀렸는지
 * 구분하지 않는다 — 구분해 주면 주소만 넣어 보고 가입 여부를 알아낼 수 있다.
 */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
  email_not_confirmed: "메일 확인이 필요합니다. 받은 메일의 링크를 눌러 주세요.",
  user_already_exists: "이미 가입된 이메일입니다. 로그인해 주세요.",
  weak_password: "비밀번호가 너무 짧습니다.",
  email_address_invalid: "이메일 주소 형식이 올바르지 않습니다.",
  validation_failed: "이메일과 비밀번호를 모두 입력해 주세요.",
  over_email_send_rate_limit: "메일을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.",
  same_password: "이전과 다른 비밀번호를 입력해 주세요.",
  link_expired: "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.",
  oauth_failed: "Google 로그인에 실패했습니다. 다시 시도해 주세요.",
  consent_required: "개인정보처리방침 동의와 만 14세 이상 확인이 모두 필요합니다.",
};

const FALLBACK = "문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";

/** 코드가 없으면 null — 화면은 이때 에러 영역을 아예 그리지 않는다. */
export function authMessage(code: string | undefined): string | null {
  if (!code) return null;
  return AUTH_MESSAGES[code] ?? FALLBACK;
}
