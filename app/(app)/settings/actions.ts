"use server";

import { redirect, RedirectType } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireConsentedUser } from "@/lib/supabase/session";

/**
 * 설정 화면이 부르는 Server Action — 회원 탈퇴(`SET-1`) 하나뿐이다.
 *
 * `app/(app)/history/actions.ts`와 같은 규약이다: 화면에 상태를 돌려주지 않고 **결과를 URL에 실어**
 * 리다이렉트한다. 덕분에 이 화면에도 `"use client"`가 없다.
 *
 * ⚠️ `redirect()`는 `NEXT_REDIRECT` 예외를 던져 흐름을 끊는다. `try`/`catch` 안에서 부르면
 * 리다이렉트가 에러로 잡아먹힌다 — 아래가 `try`를 쓰지 않는 이유이기도 하다(`deleteUser`는 던지지
 * 않고 결과 객체를 돌려준다).
 */

/** 폼에서 문자열 한 칸. FormData는 File도 담을 수 있어 타입을 좁혀야 한다. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** 2단계 주소 한 벌. 거절은 확인 화면에 **머문 채** 사유만 얹는다 — 오타를 그 자리에서 고칠 수 있게. */
function confirmUrl(error: string): string {
  return `/settings?confirm=delete&error=${error}`;
}

/**
 * 계정을 지운다. `auth.users` 한 행을 지우면 CASCADE가 다섯 테이블(`profiles`·`tags`·`job_logs`·
 * `tasks`·`task_tags`)을 데려간다 — `L-P0-02`가 세운 토대이고 `e2e/rls.spec.ts`가 실증한다.
 *
 * 🔑 **확인의 실체는 URL이 아니라 이메일 일치다.** 이 함수는 `?confirm=delete`를 **보지 않는다** —
 * 액션은 화면을 거치지 않는 직접 POST로도 호출되므로, 가드를 URL에 두면 위조 가능한 값이 삭제의
 * 문턱이 된다. 확인 화면은 사람에게 무게를 알리는 자리이고, 문턱은 아래 비교 한 줄이다.
 *
 * **확인을 비밀번호가 아니라 이메일로 받는다**(사용자 결정 2026-09-24). Google로 가입한 계정에는
 * 비밀번호가 없어 그쪽은 어느 한쪽에서 성립하지 않는다.
 *
 * 🔴 **`user.email`에 `?? ""`를 붙이지 않는다.** 이메일이 없는 계정(전화 인증 등, 지금 우리 가입
 * 경로에는 없다)에서 `?.`는 `undefined`를 내고 `field()`는 언제나 `string`을 내므로 **모든 입력이
 * 거절된다** — 분기 없이 "이메일 없는 계정은 이 경로로 못 지운다"가 성립한다. `?? ""`로 "정리"하는
 * 순간 **빈 입력이 통과한다.**
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const user = await requireConsentedUser();

  // 대소문자는 이메일 주소의 뜻을 바꾸지 않는다. 사용자가 `Me@…`로 쳤다고 거절하지 않는다.
  const typed = field(formData, "email").toLowerCase();
  if (typed !== user.email?.toLowerCase()) {
    redirect(confirmUrl("email_mismatch"), RedirectType.replace);
  }

  /*
    🔑 `sb_secret_`을 Server Action에서 쓰는 첫 자리다(`docs/03-Architecture.md` §설계 결정 8).
    경계는 "어떤 파일 종류인가"가 아니라 **브라우저 번들에 닿지 않는가**이고, Server Action은
    닿지 않는다. 지우는 대상은 `requireConsentedUser()`가 돌려준 `user.id` 하나뿐이라 남의 행이 들어갈
    자리가 없다 — 이 키로 목록을 읽거나 남의 것을 건드리는 코드는 여전히 없다.
  */
  const { error } = await createAdminSupabase().auth.admin.deleteUser(user.id);
  if (error) {
    // 되돌릴 수 없는 행동의 실패를 오류 화면으로 끝내지 않는다 — 지워졌는지 아닌지를 사용자가 알아야 한다.
    redirect(confirmUrl("delete_failed"), RedirectType.replace);
  }

  /*
    쿠키를 비우고 `/login`으로 보낸다. **지운 뒤에 부르는 것이 맞다** — 유저가 이미 없어 서버가
    404/401/403을 내지만 `auth-js`가 그것을 삼키고 로컬 세션은 어느 경로에서든 지운다. 반대로
    먼저 부르면 그 안의 `redirect()`가 흐름을 끊어 삭제에 영영 닿지 않는다.

    직접 부르지 않고 `signOut()`을 재사용한다 — `scope: "local"`(§설계 결정 18)과
    `revalidatePath("/", "layout")`이 한 곳에만 있어야 한다.
  */
  await signOut();
}
