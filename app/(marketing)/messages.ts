/**
 * 랜딩 페이지의 문구 한 자리. 한국어 문구를 검토할 때 이 파일 하나만 연다.
 *
 * 🔴 **제품이 지키지 않는 주장을 쓰지 않는다**(`docs/05-UI-Spec.md` §랜딩 페이지). 숫자는 전부
 * 시스템이 강제하는 값이다 — 10초는 `AGT-9`, 2개는 고정 단축키, 0장은 `AGT-10`. 사용자 수·만족도
 * 같은 숫자는 근거가 생기기 전에는 넣지 않는다.
 */

/**
 * 받을 수 있는 설치 파일. 🔑 **출시 상태는 여기 한 곳이 말한다** — 히어로·마무리 버튼과 안내가 전부
 * 이 표를 읽는다.
 *
 * - macOS: 공증(notarized Developer ID)된 dmg를 `public/downloads/`에 그대로 둔다. 이름에 버전을 넣지
 *   않는 것은 링크가 릴리스마다 바뀌지 않게 하기 위해서다 — 버전은 `note`가 말한다.
 * - Windows: Microsoft Store(`Tide AI`, 9MTBMNXB4V62). 공유 링크에 붙어 온 추적 인자(`cid`)는 뺐다.
 *   "Windows 10 이상"은 MSIX 도구(`msix` 패키지)의 기본 최소 버전(10.0.17763)에서 왔다 —
 *   `tide-app`의 `msix_config`에 `os_min_version`이 생기면 그 값을 따른다.
 */
export const DOWNLOADS: Record<"mac" | "windows", { href: string; label: string; note: string }> = {
  mac: {
    href: "/downloads/Tide-macOS.dmg",
    label: "macOS용 다운로드",
    note: "버전 1.8.4 · macOS 14 이상 · Apple 실리콘과 Intel",
  },
  windows: {
    href: "https://apps.microsoft.com/detail/9mtbmnxb4v62?hl=ko-KR&gl=KR",
    label: "Microsoft Store에서 받기",
    note: "Microsoft Store · Windows 10 이상",
  },
};

export const CONTACT_EMAIL = "tideai.support@gmail.com";

export const HERO = {
  title: "귀찮은 할 일 관리, 이제 캡쳐 한번으로",
  lead: "할 일이 보이는 화면을 캡처하면 Tide가 태스크로 만들어요. 끝난 일도 캡처 한 번이면 완료돼요.",
};

/** 사용법 단계의 녹화(`public/landing/`). 포스터는 각 영상의 결과 장면이다 — 멈춰 있어도 결과가 보인다. */
export const VIDEOS = [
  { src: "/landing/create.mp4", poster: "/landing/create-poster.jpg", label: "메신저의 요청을 캡처하자 알림이 뜨고 대시보드에 태스크가 생기는 화면 녹화" },
  { src: "/landing/complete.mp4", poster: "/landing/complete-poster.jpg", label: "보낸 메일을 캡처하자 알림이 뜨고 해당 태스크가 완료 처리되는 화면 녹화" },
  { src: "/landing/edit.mp4", poster: "/landing/edit-poster.jpg", label: "대시보드에서 태스크를 직접 추가하고 완료 표시를 고치는 화면 녹화" },
] as const;

export const HOW = {
  title: "단축키 두 개면 돼요.",
  steps: [
    {
      title: "캡처하면 태스크가 생겨요",
      body: "메신저든 메일이든, 할 일이 보이는 부분만 드래그하세요. 마감일은 화면에 보일 때만 적어요.",
      shortcut: 0,
    },
    {
      title: "끝난 일도 캡처로 완료해요",
      body: "“공유드렸습니다” 같은 화면을 캡처하면 맞는 태스크를 찾아 완료 처리해요.",
      shortcut: 1,
    },
    {
      title: "틀렸으면 나중에 고쳐요",
      body: "Tide는 되묻지 않고 먼저 처리해요. 대시보드에서 고치고, 히스토리에서 되돌리면 돼요.",
      shortcut: null,
    },
  ],
} as const;

export const FACTS = [
  { value: "10초", label: "캡처에서 태스크가 되기까지" },
  { value: "2개", label: "외울 단축키는 이게 전부예요" },
  { value: "0장", label: "캡처한 화면은 저장하지 않아요" },
] as const;

export const FAQ = [
  {
    q: "캡처한 화면은 어디에 저장되나요?",
    a: "어디에도 저장하지 않아요. 캡처는 태스크를 읽어 내는 데만 쓰고 바로 버려요. 남는 것은 태스크와, 왜 그렇게 판단했는지를 적은 근거 한 문장뿐이에요.",
  },
  {
    q: "왜 화면 기록과 손쉬운 사용 권한이 필요한가요?",
    a: "macOS에서만 필요해요. 화면 기록은 드래그한 영역을 캡처하는 데, 손쉬운 사용은 어느 앱을 쓰고 있든 단축키를 받는 데 써요. 처음 실행할 때 한 번만 허용하면 돼요.",
  },
  {
    q: "태스크가 잘못 만들어지면요?",
    a: "대시보드에서 제목과 마감일을 고치거나 지울 수 있어요. 캡처로 생기거나 완료된 일은 히스토리에서 하나씩 되돌릴 수 있어요.",
  },
  {
    q: "어떤 환경에서 쓸 수 있나요?",
    a: "macOS 14 이상(Apple 실리콘·Intel)과 Windows 10 이상에서 쓸 수 있어요. Windows 앱은 Microsoft Store에서 받아요.",
  },
] as const;

export const CLOSING = {
  title: "다음 할 일은 캡처로 적어 보세요.",
};

export const FOOTER = {
  tagline: "세상에서 가장 가벼운 업무 트래커",
};
