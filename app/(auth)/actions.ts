"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext, withNext } from "@/lib/auth/next";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasConsented, requireUser } from "@/lib/supabase/session";

/**
 * 인증 폼이 부르는 Server Action들.
 *
 * 화면에 상태를 돌려주지 않고 **결과를 URL에 실어 리다이렉트한다**(`?error=`, `?sent=1`).
 * 덕분에 이 루프에는 클라이언트 컴포넌트가 하나도 없다 — `useActionState`도, 브라우저 Supabase
 * 클라이언트도 필요하지 않다.
 *
 * ⚠️ `redirect()`는 `NEXT_REDIRECT` 예외를 던져서 흐름을 끊는다. **`try`/`catch` 안에서 부르면
 * 리다이렉트가 에러로 잡아먹힌다.** 아래 함수들이 전부 catch 밖에서 redirect 하는 이유다.
 */

/** 폼에서 문자열 한 칸을 꺼낸다. FormData는 File도 담을 수 있어 타입을 좁혀야 한다. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** 로그인·가입 폼이 공유하는 최소 검증. 길이·형식 규칙은 Supabase가 정한다(두 곳에 두면 갈라진다). */
function credentials(formData: FormData): { email: string; password: string } | null {
  const email = field(formData, "email");
  const password = field(formData, "password");
  return email && password ? { email, password } : null;
}

/** 메일 링크가 돌아올 주소. 배포 도메인이 늘어도 요청이 스스로 알려 주므로 env를 두지 않는다. */
async function origin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

/** 로그인 뒤 갈 곳은 폼의 숨은 칸 `next`가 정한다 — 앱 딥링크(`/auth/app/start`)가 여기로 돌아온다. */
export async function signIn(formData: FormData): Promise<void> {
  const next = safeNext(field(formData, "next"));
  const input = credentials(formData);
  if (!input) redirect(withNext("/login?error=validation_failed", next));

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(input);

  if (error) redirect(withNext(`/login?error=${error.code ?? "unknown"}`, next));

  // 레이아웃까지 다시 그려야 로그인 상태가 반영된다.
  revalidatePath("/", "layout");
  redirect(next);
}

/**
 * 가입. **메일 확인을 껐으므로(2026-09-25) 여기서 바로 세션이 선다**(§설계 결정 12).
 * 확인을 다시 켜면 `?sent=1` 안내 화면 → 메일 링크(`/auth/callback`) 경로가 그대로 살아 있다.
 */
export async function signUp(formData: FormData): Promise<void> {
  const input = credentials(formData);
  if (!input) redirect("/signup?error=validation_failed");

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    ...input,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/dashboard` },
  });

  if (error) redirect(`/signup?error=${error.code ?? "unknown"}`);

  // 메일 확인을 끈 프로젝트에서는 세션이 바로 선다. 그때는 안내 화면을 거치지 않고 들여보낸다.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  redirect("/signup?sent=1");
}

/**
 * 재설정 메일 요청.
 *
 * **성공과 실패가 같은 화면으로 끝난다.** 가입되지 않은 주소에 "그런 계정 없음"을 알려 주면
 * 주소만 넣어 보고 가입 여부를 알아낼 수 있다. 발송량 제한만은 사용자가 알아야 하므로 구분한다.
 */
export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = field(formData, "email");
  if (!email) redirect("/reset-password?error=validation_failed");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password/update`,
  });

  if (error?.code === "over_email_send_rate_limit") {
    redirect("/reset-password?error=over_email_send_rate_limit");
  }

  redirect("/reset-password?sent=1");
}

/**
 * 새 비밀번호 저장.
 *
 * 맨 앞의 `requireUser()`가 핵심이다 — Server Action은 화면을 거치지 않는 직접 POST로도 호출되므로
 * `/reset-password/update` 페이지에서 한 번 막았다고 이 액션이 안전해지지 않는다.
 */
export async function updatePassword(formData: FormData): Promise<void> {
  await requireUser();

  const password = field(formData, "password");
  if (!password) redirect("/reset-password/update?error=validation_failed");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) redirect(`/reset-password/update?error=${error.code ?? "unknown"}`);

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * 개인정보처리방침 동의 + 만 14세 이상 확인(HF-06). 두 칸이 **모두** 체크돼야 한다 — 화면의
 * `required`는 우회할 수 있으므로 여기서 다시 본다.
 *
 * 쓰기는 사용자 스코프 클라이언트로 한다. "본인 프로필만" RLS가 자기 행 하나만 허용한다. 이미
 * 동의한 계정이 다시 보내도 첫 동의 시각을 덮지 않는다.
 */
export async function acceptConsent(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (formData.get("privacy") !== "on" || formData.get("age") !== "on") {
    redirect("/consent?error=consent_required");
  }

  if (!(await hasConsented(user.id))) {
    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from("profiles")
      .update({ consented_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) redirect("/consent?error=unknown");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * **이 브라우저의 세션만 닫는다**(`scope: "local"`). 기본값 `global`은 계정의 모든 세션을 폐기해
 * 앱(`/auth/app/token`으로 받은 별도 세션)까지 로그아웃시킨다 — 앱과 웹은 따로 로그아웃한다(§설계 결정 18).
 *
 * 대신 도착 주소에 `signedOut=1`을 단다. 앱 창 속 대시보드에서 누른 로그아웃을 앱이 이 표시로
 * 알아보고 자기 토큰도 버린다(HF-05). 세션 만료로 오는 `/login`(`requireUser()`)에는 붙지 않으므로
 * 둘이 구분된다 — 이 구분이 계약(`public/api.md` §웹 로그아웃 신호)이다.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut({ scope: "local" });

  revalidatePath("/", "layout");
  redirect("/login?signedOut=1");
}
