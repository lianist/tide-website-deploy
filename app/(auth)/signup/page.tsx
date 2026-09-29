import { safeNext, withNext } from "@/lib/auth/next";

import { signUp } from "../actions";
import {
  AuthLink,
  EmailField,
  FormError,
  GoogleButton,
  Notice,
  PageTitle,
  PasswordField,
  SubmitButton,
} from "../ui";

export const metadata = { title: "회원가입 · Tide" };

/**
 * 가입 화면.
 *
 * 제출하면 곧바로 대시보드로 가지 않는다 — 메일 확인이 켜져 있어 확인 링크를 한 번 거쳐야 한다
 * (§설계 결정 12). `?sent=1`이 그 안내 상태다.
 *
 * `?next=`는 Google과 로그인 링크로만 이어진다. 메일 확인 링크는 템플릿이 `next=/dashboard`로 만들기
 * 때문에, 앱에서 온 사용자도 확인 뒤엔 대시보드에 닿고 앱에서 로그인을 한 번 더 누르면 바로 넘어간다.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  const { error, sent, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  if (sent) {
    return (
      <>
        <PageTitle>메일을 확인해 주세요</PageTitle>
        <Notice>확인 메일을 보냈습니다. 메일의 링크를 눌러 가입을 완료해 주세요.</Notice>
        <AuthLink href="/login">로그인으로 돌아가기</AuthLink>
      </>
    );
  }

  return (
    <>
      <PageTitle>회원가입</PageTitle>
      <FormError code={error} />

      <form action={signUp} className="flex flex-col gap-4">
        <EmailField />
        <PasswordField mode="new" />
        <SubmitButton>가입하기</SubmitButton>
      </form>

      <GoogleButton next={next} />

      <AuthLink href={withNext("/login", next)}>이미 계정이 있으신가요? 로그인</AuthLink>
    </>
  );
}
