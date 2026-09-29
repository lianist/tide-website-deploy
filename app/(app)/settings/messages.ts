/**
 * 설정 화면의 한국어 문구.
 *
 * **`actions.ts`와 같은 파일에 둘 수 없다.** `"use server"` 파일은 모든 export가 async 함수여야
 * 해서 상수를 내보내면 빌드가 깨진다 — `app/(auth)/messages.ts`·`app/(app)/dashboard/messages.ts`가
 * 갈라져 있는 이유와 같다.
 *
 * 문구 표는 [`docs/05-UI-Spec.md`](../../../docs/05-UI-Spec.md) §설정의 고정 문구 표와 1:1이다.
 * 한쪽만 고치면 검증이 문장을 못 찾는다.
 */

/**
 * 탈퇴 거절을 URL에 실어 나른다(`?confirm=delete&error=<code>`).
 *
 * **어휘는 소문자 화면 코드다.** 태그·히스토리가 대문자 API 사유를 쓰는 이유는 그 문장들이 이미
 * `409` 본문으로 나가는 완성된 한국어이기 때문인데(`L-P1-06`), 설정에는 API가 없어 대응하는 사유
 * 토큰 자체가 없다. 그래서 대시보드·인증과 같은 소문자다.
 */
const SETTINGS_MESSAGES: Record<string, string> = {
  email_mismatch: "이메일이 일치하지 않습니다.",
  delete_failed: "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

const FALLBACK = "문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";

/** 코드가 없으면 null — 화면은 이때 거절 영역을 아예 그리지 않는다. */
export function settingsMessage(code: string | undefined): string | null {
  if (!code) return null;
  return SETTINGS_MESSAGES[code] ?? FALLBACK;
}

/**
 * 1단계의 안내. **여기서 이미 "되돌릴 수 없다"를 말한다** — 2단계로 넘어가기 전에 무게를 알려야
 * 확인 화면이 놀라움이 되지 않는다.
 */
export const DELETE_LEAD = "계정과 모든 데이터가 영구히 삭제됩니다. 되돌릴 수 없습니다.";

/** 2단계의 경고. 무엇이 지워지는지를 `SET-1`의 열거 그대로 적는다. */
export const DELETE_WARNING =
  "탈퇴하면 태스크, 태그, 작업 기록이 모두 지워집니다. 되돌릴 수 없습니다.";

/** 2단계의 확인 요구. 뒤에 계정 이메일이 붙는다. */
export const DELETE_CONFIRM_LEAD = "계속하려면 계정 이메일을 그대로 입력해 주세요.";
