import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui";
import { hasConsented, requireUser } from "@/lib/supabase/session";

import { acceptConsent, signOut } from "../actions";
import { FormError, PageTitle, SubmitButton } from "../ui";

export const metadata = { title: "개인정보처리방침 동의 · Tide" };

/**
 * 개인정보처리방침 동의 + 만 14세 이상 확인(HF-06). 동의 전 계정은 `(app)`의 모든 화면이 여기로
 * 보낸다(`requireConsentedUser()`). API는 같은 계정에 `403 CONSENT_REQUIRED`를 준다.
 *
 * [동의하지 않음]은 로그아웃이다 — 계정을 지우지 않는다(사용자 결정 2026-09-27). 로그아웃은
 * `/login?signedOut=1`에 도착하므로 앱 웹뷰에서 누르면 앱도 토큰을 버린다.
 *
 * 두 칸의 `required`는 브라우저 편의일 뿐이다. 판정은 `acceptConsent`가 서버에서 다시 한다.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (await hasConsented(user.id)) redirect("/dashboard");
  const params = await searchParams;

  return (
    <>
      <PageTitle>시작하기 전에</PageTitle>
      <p className="text-body-s text-ink-secondary">
        Tide는 캡처한 화면을 AI로 분석해 할 일을 만듭니다. 캡처 이미지는 저장하지 않고 분석에만
        씁니다.
      </p>
      <FormError code={params.error} />

      <form action={acceptConsent} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-body text-ink">
            <input type="checkbox" name="privacy" required className="mt-1 size-4 accent-brand" />
            개인정보처리방침에 동의합니다
          </label>
          <Link
            href="/privacy"
            target="_blank"
            className="ml-6 text-body-s text-brand underline hover:text-brand-hover"
          >
            개인정보처리방침 전문 보기
          </Link>
          <label className="flex items-start gap-2 text-body text-ink">
            <input type="checkbox" name="age" required className="mt-1 size-4 accent-brand" />
            만 14세 이상입니다
          </label>
        </div>
        <SubmitButton>동의하고 시작하기</SubmitButton>
      </form>

      <form action={signOut} className="flex flex-col">
        <Button tone="quiet">동의하지 않음</Button>
      </form>
    </>
  );
}
