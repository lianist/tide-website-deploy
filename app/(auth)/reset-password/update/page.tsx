import { requireUser } from "@/lib/supabase/session";

import { updatePassword } from "../../actions";
import { FormError, PageTitle, PasswordField, SubmitButton } from "../../ui";

export const metadata = { title: "새 비밀번호 설정 · Tide" };

/**
 * 메일 링크로 돌아온 사람이 새 비밀번호를 넣는 화면.
 *
 * 링크가 `/auth/callback`을 지나며 세션을 세워 두었으므로 여기서는 평범한 로그인 사용자다.
 * 링크 없이 주소만 치고 들어오면 `requireUser()`가 `/login`으로 돌려보낸다.
 */
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;

  return (
    <>
      <PageTitle>새 비밀번호 설정</PageTitle>
      <FormError code={error} />

      <form action={updatePassword} className="flex flex-col gap-4">
        <PasswordField mode="new" />
        <SubmitButton>비밀번호 저장</SubmitButton>
      </form>
    </>
  );
}
