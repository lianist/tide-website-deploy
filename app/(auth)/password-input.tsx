"use client";

import { useState } from "react";

import { Icon } from "@/components/icons";
import { inputClass } from "@/components/ui";

/**
 * 비밀번호 칸 + 자체 [보기] 토글.
 *
 * **왜 우리가 그리는가** — 브라우저가 그려 주는 기본 눈 버튼(Edge의 `::-ms-reveal`)은 브라우저
 * 셸의 UI라, Ttabong이 띄우는 임베디드 웹뷰(WebView2)에서는 **그려지기만 하고 눌러도 아무 일이
 * 일어나지 않는다.** macOS의 WKWebView에는 그 버튼이 아예 없다. 그래서 앱 안에서는 방금 친 글자를
 * 확인할 길이 전혀 없었다(앱 부서 보고, 2026-09-25). 기본 버튼은 `globals.css`에서 숨긴다 —
 * 남겨 두면 브라우저에서만 눈이 둘로 보인다.
 *
 * 🔴 **저장소의 두 번째 `"use client"`다**(첫째는 `app/(app)/dashboard/realtime.tsx`).
 * `type`을 오가는 일은 서버가 할 수 없다 — `next=`를 한 칸 더 쓰는 식의 URL 왕복으로도 되지만,
 * 그러면 비밀번호를 지운 채 화면이 다시 서거나 비밀번호가 주소에 실린다. 경계는 이 파일까지다:
 * 데이터를 읽지 않고, 폼 제출은 여전히 Server Action이 받는다.
 *
 * 누르고 있는 동안만 보이는 방식(앱이 임시로 쓰던 것)이 아니라 **누를 때마다 뒤집는다** — 웹의
 * 관례이고, 키보드만 쓰는 사람에게 `Enter`를 누른 채 읽으라고 할 수는 없다.
 */
export function PasswordInput({ mode, label }: { mode: "current" | "new"; label: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        name="password"
        autoComplete={mode === "new" ? "new-password" : "current-password"}
        required
        /*
          🔴 이름을 **직접** 준다. 감싸는 `<label>`에 토글 버튼까지 들어 있어, 라벨에서 이름을 따면
          입력의 이름이 "비밀번호 비밀번호 보기"가 된다 — 스크린 리더가 그렇게 읽고, `getByLabel`도
          입력과 버튼을 함께 잡는다(HF-02 뒤 첫 전체 테스트에서 발견).
        */
        aria-label={label}
        /* 오른쪽 48px은 토글이 앉을 자리다. 글자가 그 아래로 흘러 들어가지 않게 비워 둔다. */
        className={`${inputClass} pr-12`}
      />
      {/*
        🔴 `type="button"`이다. 폼 안의 버튼은 기본이 제출이라, 빼면 [보기]가 로그인을 시도한다.

        접근 이름은 `aria-label`이 든다(아이콘은 언제나 `aria-hidden`이다 — `components/icons.tsx`).
        상태는 `aria-pressed`로도 말한다. 라벨이 입력을 감싸고 있지만 이 버튼은 **상호작용 요소**라
        라벨의 활성화가 전달되지 않는다(HTML 표준) — 눌러도 입력으로 포커스가 튀지 않는다.
      */}
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-control text-ink-secondary hover:text-ink"
      >
        <Icon name={visible ? "eye-off" : "eye"} />
      </button>
    </div>
  );
}
