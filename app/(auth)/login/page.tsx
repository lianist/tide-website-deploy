import { safeNext, withNext } from "@/lib/auth/next";

import { signIn } from "../actions";
import {
  AuthLink,
  EmailField,
  FormError,
  GoogleButton,
  PageTitle,
  PasswordField,
  SubmitButton,
} from "../ui";

export const metadata = { title: "로그인 · Tide" };

/**
 * Next 16에서 `searchParams`는 Promise다 — await 없이 읽으면 타입이 맞지 않는다.
 *
 * `?next=`는 로그인 뒤 돌아갈 곳이다(앱 딥링크가 `/auth/app/start`를 싣는다). 폼·Google·가입 링크
 * 어느 길로 가도 잃지 않도록 전부에 실어 둔다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <>
      <PageTitle>로그인</PageTitle>
      <FormError code={params.error} />

      <form action={signIn} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <EmailField />
        <PasswordField mode="current" />
        <SubmitButton>로그인</SubmitButton>
      </form>

      <GoogleButton next={next} />

      <div className="flex flex-col gap-2">
        <AuthLink href="/reset-password">비밀번호를 잊으셨나요?</AuthLink>
        <AuthLink href={withNext("/signup", next)}>계정이 없으신가요? 가입하기</AuthLink>
      </div>
    </>
  );
}
