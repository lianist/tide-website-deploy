import Link from "next/link";

import { Alert, Button, Field, buttonClass, cardClass, inputClass } from "@/components/ui";
import { requireConsentedUser } from "@/lib/supabase/session";

import { AppShell } from "../shell";

import { deleteAccount } from "./actions";
import {
  DELETE_CONFIRM_LEAD,
  DELETE_LEAD,
  DELETE_WARNING,
  settingsMessage,
} from "./messages";

export const metadata = { title: "설정 · Tide" };

/** 배열로 실려 온 값은 없는 것으로 본다 — 주소창은 사람이 치는 자리라 400을 내지 않는다. */
function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 설정 — `SET-1`. 계정을 확인하고 **스스로 지우는** 자리다.
 *
 * **탈퇴가 2단계다.** `/settings`는 무엇이 사라지는지 알려 주기만 하고, 지우는 폼은
 * `?confirm=delete`에만 있다. 🔑 다만 **`?confirm=delete`는 가드가 아니라 화면 전환이다** — 실제
 * 문턱은 Server Action 안의 이메일 비교 한 줄이고, 그래서 액션을 직접 POST해도 지워지지 않는다.
 * 위조 가능한 URL 값이 삭제의 문턱이 되는 구조를 만들지 않는다.
 *
 * 1단계 → 2단계는 **링크(GET)** 다. 쓰기가 아니고, 화면의 모든 상태가 URL에 있다는 이 저장소의
 * 태도 그대로다. "`<a>`로 쓰기를 만들지 않는다"는 금지는 쓰기에 걸린 것이고, 쓰기는 2단계의
 * `<form>`이 한다.
 *
 * `"use client"`가 없다. `confirm()` 대신 URL 한 칸으로 확인 단계를 만든 것이 그 대가를 치르지
 * 않은 이유다(사용자 결정 2026-09-24).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string | string[]; error?: string | string[] }>;
}) {
  const user = await requireConsentedUser();
  const params = await searchParams;

  const confirming = first(params.confirm) === "delete";
  const error = settingsMessage(first(params.error));

  return (
    <AppShell current="settings" email={user.email} title="설정">
      <section className={`${cardClass} flex flex-col gap-2 p-6`} aria-labelledby="account-heading">
        <h2 id="account-heading" className="font-heading text-h2 text-ink">
          계정
        </h2>
        {/*
          🔴 **사이드바에 이메일이 있는데도 여기 한 번 더 그린다.** 저쪽 사본은 240px 사이드바 안에서
          `truncate`라 주소가 길면 잘린다. 2단계가 "이 주소를 그대로 치라"고 요구하므로, 화면의 유일한
          사본이 잘려 있으면 동선이 성립하지 않는다 — 장식이 아니라 확인 단계의 전제다.
        */}
        <p className="text-body-s text-ink-secondary">
          이메일 <span className="text-body text-ink">{user.email}</span>
        </p>
      </section>

      {confirming ? (
        <section className={`${cardClass} flex flex-col gap-4 p-6`} aria-labelledby="delete-heading">
          <h2 id="delete-heading" className="font-heading text-h2 text-ink">
            회원 탈퇴
          </h2>

          {/*
            🔴 경고를 `Alert`로 그리지 않는다. `Alert`는 `role="alert"` + 빨강이고 이 저장소에서 뜻이
            "폼 실패" 하나로 고정돼 있다 — 경고에 쓰면 아무것도 안 했는데 실패한 것처럼 보이고, 아래
            거절 문구와 `role="alert"`가 둘이 되어 "무엇이 거절됐는지"를 집는 검증이 흐려진다.
            파괴성의 무게는 danger 버튼과 이메일 재입력이 이미 진다.
          */}
          <p className="text-body text-ink">{DELETE_WARNING}</p>

          <p className="text-body-s text-ink-secondary">
            {DELETE_CONFIRM_LEAD} <span className="text-ink">{user.email}</span>
          </p>

          {error && <Alert>{error}</Alert>}

          <form action={deleteAccount} className="flex flex-col gap-4">
            <Field label="이메일">
              {/*
                `app/(auth)/ui.tsx`의 `EmailField`를 쓰지 않는다 — 그쪽은 `(auth)` 그룹의 조립이고
                `autoComplete="email"`이 붙어 있다. 브라우저가 채워 주는 순간 "그대로 쳐서 확인한다"가
                한 번의 클릭이 되어 확인 단계가 사라진다.
              */}
              <input
                type="email"
                name="email"
                autoComplete="off"
                required
                className={inputClass}
              />
            </Field>

            {/* 안전한 쪽이 시각적으로 더 무겁다. 이 카드에 인디고 채움 버튼은 없다. */}
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/settings" className={buttonClass("secondary")}>
                취소
              </Link>
              <Button tone="danger">영구 삭제</Button>
            </div>
          </form>
        </section>
      ) : (
        <section className={`${cardClass} flex flex-col gap-4 p-6`} aria-labelledby="delete-heading">
          <h2 id="delete-heading" className="font-heading text-h2 text-ink">
            회원 탈퇴
          </h2>
          <p className="text-body-s text-ink-secondary">{DELETE_LEAD}</p>
          <div className="flex justify-end">
            {/* 🔴 1단계에는 `<button>`이 없다. 지우는 수단은 확인 화면에만 있다. */}
            <Link href="/settings?confirm=delete" className={buttonClass("secondary")}>
              계정 삭제
            </Link>
          </div>
        </section>
      )}
    </AppShell>
  );
}
