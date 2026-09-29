import Link from "next/link";

import { Alert, Button, Field, Notice as BaseNotice, buttonClass, inputClass } from "@/components/ui";
import { withNext } from "@/lib/auth/next";

import { authMessage } from "./messages";
import { PasswordInput } from "./password-input";

/**
 * 인증 화면 조각들. 비밀번호 칸의 [보기] 토글(`password-input.tsx`) 하나만 클라이언트고 나머지는
 * 전부 서버에서 그려진다.
 *
 * 폼 자체를 컴포넌트로 감싸지 않은 것은 의도다. 세 화면의 필드 구성이 서로 달라서, 감싸면
 * 곧바로 분기 옵션이 붙는다. 반복되는 것은 스타일뿐이고, 그것은 이제 `components/ui.tsx`가
 * 들고 있다 — 여기 남은 것은 **이 화면들만의 조립**이다.
 */

export function PageTitle({ children }: { children: string }) {
  return <h1 className="font-heading text-h1 text-ink">{children}</h1>;
}

/** `?error=` 코드를 문장으로 바꿔 보여 준다. 코드가 없으면 아무것도 그리지 않는다. */
export function FormError({ code }: { code: string | undefined }) {
  const message = authMessage(code);
  if (!message) return null;

  return <Alert>{message}</Alert>;
}

/** 메일을 보냈다는 안내. 성공 경로에서만 쓴다. */
export function Notice({ children }: { children: string }) {
  return <BaseNotice>{children}</BaseNotice>;
}

export function EmailField() {
  return (
    <Field label="이메일">
      <input type="email" name="email" autoComplete="email" required className={inputClass} />
    </Field>
  );
}

/**
 * 가입·재설정은 `new-password`, 로그인은 `current-password` — 비밀번호 관리자가 이걸 본다.
 *
 * 라벨은 여기(서버)에 남고 [보기] 토글이 붙은 입력만 클라이언트로 내려간다 — `PasswordInput`.
 */
export function PasswordField({ mode }: { mode: "current" | "new" }) {
  const label = "비밀번호";
  return (
    <Field label={label}>
      <PasswordInput mode={mode} label={label} />
    </Field>
  );
}

/** 이 카드의 유일한 인디고 채움 버튼이다(키트 3-2). Google은 아래에서 2차로 간다. */
export function SubmitButton({ children }: { children: string }) {
  return <Button>{children}</Button>;
}

/** 바깥 도메인으로 나가는 이동이라 버튼이 아니라 링크다. JavaScript 없이도 동작한다. */
export function GoogleButton({ next }: { next: string }) {
  return (
    <a href={withNext("/auth/google", next)} className={buttonClass("secondary")}>
      Google로 계속하기
    </a>
  );
}

/** 링크는 인디고다 — 키트가 "링크·선택 = secondary-600 글자"로 정해 두었다(3-1). */
export function AuthLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="text-body-s text-brand underline hover:text-brand-hover">
      {children}
    </Link>
  );
}
