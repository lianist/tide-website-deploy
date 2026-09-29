"use server";

import { refresh } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { isUuid } from "@/lib/api/input";
import { revertJobLog } from "@/lib/api/job-logs";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireConsentedUser } from "@/lib/supabase/session";

/**
 * 히스토리가 부르는 Server Action(`HIST-3`·`HIST-4`의 화면 쪽).
 *
 * `app/(app)/dashboard/actions.ts`와 같은 규약이다 — 화면에 상태를 돌려주지 않고 **결과를 URL에
 * 실어** 리다이렉트한다. 덕분에 이 화면에도 `"use client"`가 없다.
 *
 * **되돌리기의 알맹이는 여기 없다.** `POST /api/v1/job-logs/:id/revert`가 부르는 것과 **같은
 * `revertJobLog()`** 를 봉투 없이 부른다(`API-5`). 판정도 쓰기도 DB 함수가 한 트랜잭션으로 하고,
 * 거절 문장은 `lib/api/job-logs.ts`의 표 하나에서만 나온다.
 *
 * ⚠️ `redirect()`는 `NEXT_REDIRECT` 예외를 던져 흐름을 끊는다. `try`/`catch` 안에서 부르면
 * 리다이렉트가 에러로 잡아먹힌다.
 */

/** 폼에서 문자열 한 칸. FormData는 File도 담을 수 있어 타입을 좁혀야 한다. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 히스토리 주소 한 벌.
 *
 * 🔴 **`log`이 두 뜻을 겸한다** — 앱 알림이 여는 딥링크 표지(`NTF-4`)이면서, 거절된 기록을 짚는
 * 자리다. 파라미터를 둘로 나누지 않은 것은 화면이 하는 일이 같아서다: 그 항목에
 * `aria-current="page"`를 달고 인디고 테두리를 세운다. 사용자 결정(2026-09-24)으로 거절 문구가
 * **그 항목 안에** 서므로, 짚는 일과 문구를 붙이는 일이 애초에 한 동작이다.
 */
function historyUrl(params: { log?: string; error?: string }) {
  const query = new URLSearchParams();
  if (params.log) query.set("log", params.log);
  if (params.error) query.set("error", params.error);

  const suffix = query.toString();
  return suffix ? `/history?${suffix}` : "/history";
}

/**
 * 성공했으니 같은 자리로 돌아간다. **둘 다 부르는 것이 의도다** — 근거는
 * `app/(app)/dashboard/actions.ts`의 `backTo` 주석 그대로다. `refresh()`가 없으면 URL이 그대로일 때
 * 목록이 다시 그려지지 않아 **되돌렸는데 버튼이 남아 있고**, `redirect()`가 없으면 앞선 실패가
 * 남긴 `?error=`가 주소에 남아 빨간 문구가 계속 보인다.
 */
function backTo(url: string): never {
  refresh();
  redirect(url, RedirectType.replace);
}

/**
 * 작업 로그 하나를 되돌린다 — 생성이면 태스크 삭제, 완료면 `todo`로(무엇을 되돌릴지는 로그의
 * `outcome`이 정한다).
 *
 * **확인 단계를 두지 않았다**(사용자 결정 2026-09-24). 지워지는 것은 `TASK_MODIFIED` 가드를
 * 통과한 태스크뿐이라 **에이전트가 만들고 사용자가 한 번도 손대지 않은 것**만 사라진다.
 */
export async function revertLog(formData: FormData): Promise<void> {
  await requireConsentedUser();
  const supabase = await createServerSupabase();

  const id = field(formData, "id");
  // 원래 주소에 실려 있던 `?log=`. 성공하면 짚고 있던 항목을 계속 짚어 준다.
  const log = field(formData, "log");

  if (!isUuid(id)) {
    redirect(historyUrl({ error: "JOB_LOG_NOT_FOUND" }), RedirectType.replace);
  }

  const result = await revertJobLog(supabase, id);
  if (!result.ok) {
    // 🔴 `log`을 **거절 대상으로 덮는다.** 그래야 사유 문장이 그 항목 안에 선다 — 기록이 100건까지
    // 쌓이는 화면에서 상단 배너는 "어느 것이 거절됐는지"를 말해 주지 못한다.
    redirect(historyUrl({ log: id, error: result.reason }), RedirectType.replace);
  }

  // 성공 안내를 띄우지 않는다(사용자 결정). [되돌리기]와 관련 태스크 링크가 사라지는 것이 결과다.
  backTo(historyUrl({ log: isUuid(log) ? log : undefined }));
}
