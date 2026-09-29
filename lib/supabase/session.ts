import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import type { Database } from "./database.types";
import { createServerSupabase } from "./server";

/**
 * 웹 화면의 인증 확인 — `lib/api/auth.ts`의 `withAuth`가 API에서 하는 일을 여기서 한다.
 *
 * **판단은 여기 한 곳에만 있다.** `proxy.ts`는 쿠키를 갱신할 뿐 누구인지 판정하지 않는다.
 * 이유는 `docs/03-Architecture.md` §설계 결정 10 — 판단하는 자리가 둘이 되면 언젠가 갈라진다.
 */

export interface WebUser {
  id: string;
  email: string | null;
}

/**
 * **`getSession()`이 아니라 `getClaims()`다.** 쿠키는 사용자가 고칠 수 있으므로 그 안의 사용자
 * 정보를 그대로 믿으면 안 된다. `getClaims`는 ES256 서명을 WebCrypto로 로컬 검증한다 —
 * `withAuth`가 이미 택한 것과 같은 선택이고, 이유도 같다(§설계 결정 9).
 *
 * `cache()`는 렌더 한 번 안의 중복 호출을 접는다. 레이아웃과 페이지가 각각 불러도 검증은 1회다.
 */
export const currentUser = cache(async (): Promise<WebUser | null> => {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const { sub, email } = data.claims;
  return { id: sub, email: typeof email === "string" ? email : null };
});

/**
 * 로그인하지 않았으면 `/login`으로 보낸다.
 *
 * **Server Action에서도 맨 앞에서 부른다.** Server Action은 화면을 거치지 않는 직접 POST로도
 * 호출되므로(Next 데이터 보안 가이드), 페이지에서 한 번 막았다고 액션이 안전해지지 않는다.
 */
export async function requireUser(): Promise<WebUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * 로그인했고 **개인정보처리방침에 동의한** 사용자만 통과시킨다(HF-06). 동의 전이면 `/consent`로 보낸다.
 *
 * `(app)`의 화면과 Server Action은 전부 이것을 부른다 — `requireUser()`를 직접 부르는 곳은 동의를
 * 받는 자리(`/consent`와 그 액션)와 동의와 무관한 자리(비밀번호 재설정·로그아웃)뿐이다. API 쪽의
 * 같은 판단은 `withAuth`가 한다.
 *
 * 동의 여부는 `profiles.consented_at`이다(null = 미동의). 행이 없는 계정도 미동의로 본다 — 가입
 * 트리거 이전 계정은 백필이 행을 만들었고, 기존 행은 동의 마이그레이션이 전부 채웠다.
 */
export async function requireConsentedUser(): Promise<WebUser> {
  const user = await requireUser();
  if (!(await hasConsented(user.id))) redirect("/consent");
  return user;
}

/** `cache()` — 레이아웃·페이지·액션이 한 렌더 안에서 여러 번 물어도 조회는 1회다. */
export const hasConsented = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("consented_at")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data?.consented_at);
});

/** 가입 트리거가 넣는 기본값과 같다(`…_signup_bootstrap.sql`). 행이 없을 때 갈 곳. */
const DEFAULT_TIME_ZONE = "Asia/Seoul";

/**
 * 마감 판정·표시·저장의 기준 시간대(`docs/03-Architecture.md` §설계 결정 19).
 *
 * 화면(`app/(app)/dashboard/page.tsx`)과 Server Action(`app/(app)/dashboard/actions.ts`)이 함께 쓴다.
 * 두 곳에 같은 쿼리를 적으면 **`maybeSingle()`이어야 한다는 것**(가입 트리거 이전에 만들어진
 * 계정에서 `single()`은 화면 전체를 500으로 만든다)과 기본값이 조용히 갈라진다.
 *
 * 폼의 숨은 칸으로 나르지 않는다 — 위조되면 마감이 몇 시간 밀린 채 저장된다.
 */
export async function userTimeZone(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return data?.timezone ?? DEFAULT_TIME_ZONE;
}
