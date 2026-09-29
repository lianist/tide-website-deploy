import { requestPasswordReset } from "../actions";
import { AuthLink, EmailField, FormError, Notice, PageTitle, SubmitButton } from "../ui";

export const metadata = { title: "비밀번호 재설정 · Tide" };

/**
 * 재설정 메일 요청.
 *
 * **가입되지 않은 주소에도 같은 성공 화면을 보여 준다.** 구분해 주면 주소만 넣어 보고 가입 여부를
 * 알아낼 수 있다(문구 규칙은 `app/(auth)/messages.ts`).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  if (sent) {
    return (
      <>
        <PageTitle>메일을 확인해 주세요</PageTitle>
        <Notice>재설정 메일을 보냈습니다. 메일함을 확인해 주세요.</Notice>
        <AuthLink href="/login">로그인으로 돌아가기</AuthLink>
      </>
    );
  }

  return (
    <>
      <PageTitle>비밀번호 재설정</PageTitle>
      <Notice>가입한 이메일 주소로 재설정 링크를 보내 드립니다.</Notice>
      <FormError code={error} />

      <form action={requestPasswordReset} className="flex flex-col gap-4">
        <EmailField />
        <SubmitButton>재설정 메일 보내기</SubmitButton>
      </form>

      <AuthLink href="/login">로그인으로 돌아가기</AuthLink>
    </>
  );
}
