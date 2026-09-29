/**
 * 대시보드의 한국어 문구.
 *
 * 히스토리와 함께 쓰는 `SOURCE_LABEL`은 `app/(app)/messages.ts`로 올라갔다(`L-P1-03`).
 *
 * **`actions.ts`와 같은 파일에 둘 수 없다.** `"use server"` 파일은 모든 export가 async 함수여야
 * 해서 상수를 내보내면 빌드가 깨진다 — `app/(auth)/messages.ts`가 갈라져 있는 이유와 같다.
 */

/**
 * 폼 실패를 URL에 실어 나른다(`?error=<code>`). 인증 화면과 같은 방식이고, 같은 대가를 치른다 —
 * **입력이 날아간다.** 살리려면 `useActionState`가 필요하고 그것은 클라이언트 컴포넌트를 부른다.
 *
 * 실제로 여기까지 오는 실패는 셋뿐이다. 제목이 공백뿐(잃을 입력이 없다), 마감 날짜 없이 시각만,
 * 그리고 다른 탭에서 태스크가 지워진 경우(드물다). 감수할 만하다.
 */
const DASHBOARD_MESSAGES: Record<string, string> = {
  validation_failed: "입력을 확인해 주세요.",
  title_required: "제목을 입력해 주세요.",
  due_date_required: "마감 시각만으로는 저장할 수 없습니다. 날짜를 함께 골라 주세요.",
  due_date_invalid: "마감 날짜가 올바르지 않습니다.",
  not_found: "태스크를 찾을 수 없습니다. 삭제되었을 수 있습니다.",
};

const FALLBACK = "문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";

/** 코드가 없으면 null — 화면은 이때 에러 영역을 아예 그리지 않는다. */
export function dashboardMessage(code: string | undefined): string | null {
  if (!code) return null;
  return DASHBOARD_MESSAGES[code] ?? FALLBACK;
}

/** 근거(`tasks.rationale`)가 없을 때. 항목 자체는 남긴다 — 7개는 언제나 7개다. */
export const NO_RATIONALE = "에이전트가 남긴 근거가 없습니다.";
