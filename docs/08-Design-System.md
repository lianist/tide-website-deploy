# 08 — 디자인 시스템

이 문서는 **"이 색·글자 크기·간격·컴포넌트를 어떻게 고르지?"** 한 가지 질문에 답한다.
화면마다 무엇이 보여야 하는지는 [`05-UI-Spec.md`](05-UI-Spec.md)가, 왜 이 방식을 골랐는지는 [`03-Architecture.md`](03-Architecture.md) §설계 결정 23이 답한다.

## 어디서 왔는가

시각 언어의 **상위 SSOT는 저장소 안의 디자인 키트** `tide-kit-v3.0/`이다.

| 파일 | 무엇 |
|---|---|
| `tide-kit-v3.0/design-spec.md` | 🔑 **기준 문서.** 브랜드·타이포·컬러·컴포넌트·접근성 대비표 |
| `tide-kit-v3.0/web/tide-tokens.css` | 웹용 CSS 변수 원문 — `app/globals.css` 1층이 이것의 사본이다 |
| `tide-kit-v3.0/assets/{brand,icons,app-icon}/` | 로고·아이콘 SVG, 앱 아이콘 PNG |
| `tide-kit-v3.0/mockups/*.png` | 목업 8장. 육안 검증의 기준 |
| `tide-kit-v3.0/flutter-porting-guide.md` | 데스크톱 앱(짝 저장소 `lianist/tide-app`) 몫. 웹은 범위 밖이라고 이 문서가 직접 밝힌다 |

🔴 **값을 코드에서 고치지 않는다.** 키트가 못 박은 규칙이다 — *"값이 바뀌면 `design-spec.md`를 먼저 고치고 토큰 파일을 맞춘다."* 색 하나를 바꾸고 싶으면 키트를 먼저 고치고, `app/globals.css` 1층을 다시 맞춘다.

`tide-kit-v3.0/flutter/`는 `.gitignore`에 있다 — 11MB가 전부 데스크톱 폰트 바이너리와 Dart 코드이고 이 저장소는 웹·API·에이전트만 구현한다.

## 토큰은 어디에 있는가 — `app/globals.css` 2층 구조

```
@import "tailwindcss";

:root  { … }   ← 1층. 키트 원문 사본. 이름도 값도 키트 그대로.
@theme { … }   ← 2층. Tailwind 네임스페이스 별칭. 화면 코드가 보는 것.
```

**왜 갈랐는가.** 키트의 역할 토큰 이름 몇 개가 Tailwind v4의 네임스페이스와 부딪힌다. 키트의 `--text-secondary`를 `@theme`에 그대로 넣으면 Tailwind가 **글자 크기** 네임스페이스(`--text-*`)로 읽어 `text-secondary`가 색이 아니라 font-size 유틸리티가 된다. 1층을 평범한 `:root`로 두면 Tailwind가 파싱하지 않으므로 키트 원문을 **글자 하나 바꾸지 않고** 보관할 수 있고, 2층에서 이름만 갈아 끼운다.

### 이름 대응표 (키트 → 화면 코드)

| 키트 | Tailwind 유틸리티 | 왜 이름이 다른가 |
|---|---|---|
| `--bg-page` | `bg-page` | — |
| `--bg-surface` | `bg-surface` | — |
| `--bg-subtle` | `bg-subtle` | — |
| `--border` | `border-line` | `border`는 Tailwind에서 "테두리 1px"이라는 다른 뜻 |
| `--border-input` | `border-line-input` | 위와 같음 |
| `--text` | `text-ink` | `--text-*`가 글자 **크기** 네임스페이스 |
| `--text-secondary` | `text-ink-secondary` | 위와 같음 |
| `--text-disabled` | `text-ink-disabled` | 위와 같음 |
| `--brand` / `--brand-hover` | `bg-brand` / `hover:bg-brand-hover` | — |
| `--on-brand` / `--on-brand-secondary` | `text-on-brand` / `text-on-brand-secondary` | — |
| `--auto-bg` / `--auto-border` / `--auto-text` / `--auto-dot` | `bg-auto-bg` / `border-auto-line` / `text-auto-ink` / `bg-auto-dot` | `border`는 위와 같은 이유 |
| `--attention-*` | `bg-attention-bg` / `border-attention-line` / `text-attention-ink` / `text-attention-icon` | 위와 같음 |
| `--urgent` | `text-urgent` | 오늘 마감 |
| `--error-bg` / `--error-text` | `bg-error-bg` / `text-error-ink` | — |

키트가 **Dart에만 두고 CSS에는 내지 않은** 네 개도 1층에 이어 붙였다(값은 `tide_roles.dart`·`tide_metrics.dart` 원문 그대로): `--ring-idle`(여유 마감 링) · `--brand-subtle`(Text 버튼 hover) · `--status-bg`/`--status-text`(상태 필).

### 키트에서 한 발 나간 것 하나 — `--overdue`

키트는 **마감 당일과 지남을 둘 다 `error-600`**으로 둔다. 도치는 두 단계를 색으로도 갈라 온 화면이라(`05-UI-Spec.md` §대시보드) 지남만 한 단계 진한 `error-700`을 쓴다.

| 단계 | 토큰 | 값 | 흰 배경 대비 |
|---|---|---|---|
| 마감 지남 | `text-overdue` | `#AA1D2D` (error-700) | 7.3 : 1 |
| 오늘 마감 | `text-urgent` | `#CE343F` (error-600) | 5.0 : 1 |
| 그 밖 | `text-ink-secondary` | `#6D6D6D` (primary-600) | 5.4 : 1 |

셋 다 AA(4.5:1)를 넘고, 키트의 "빨강은 마감·오류에만" 안에 있다. 색은 **보조**다 — 접두사 글자("마감 지남"·"오늘 마감")가 본체다.

## 쓰는 법

- **화면 코드는 역할 이름만 쓴다** — `bg-surface`·`text-ink`·`border-line`. 원자(`bg-primary-200`)는 역할이 아직 없는 자리에서만 쓰고, 두 번 쓰게 되면 역할을 하나 판다.
- 🔑 **기본 팔레트를 비운다.** `@theme`의 `--color-*: initial`이 Tailwind 기본 색을 전부 지운다. `bg-blue-500`은 유틸리티가 **생성되지 않아** 아무 일도 하지 않는다. `--text-*: initial`도 같은 이유다: `text-sm`·`text-2xl`은 존재하지 않는다.
  - ⚠️ **이것은 빌드 게이트가 아니다.** Tailwind v4는 모르는 유틸리티를 에러 없이 조용히 버린다(에러가 나는 곳은 `@apply` 경로뿐이다). 남아 있는 `bg-gray-50`은 lint도 build도 통과하면서 **스타일만 사라진다.** 키트의 QA 규칙 — *"화면에 회색·인디고·(마감/오류의) 빨강 말고 다른 색이 없어야 한다"* — 을 실제로 지키는 것은 아래 §커밋 전 확인의 grep이고, 리셋은 새 코드가 기본 팔레트에 손대지 못하게 막는 보조 장치다.
  - **켜는 순서가 중요했다.** 모든 화면을 역할 토큰으로 옮긴 뒤(`L-DS-03`) 마지막에 켰다. 먼저 켰다면 아직 `bg-gray-900`을 쓰던 화면이 조용히 무스타일로 렌더돼, 그 루프가 게이트를 통과한 것인지 아닌지를 구분할 수 없었다.

### 타이포 — 아홉 단계

크기·행간·자간·굵기가 토큰 하나에 묶여 있다. `text-h2` 한 마디가 키트의 H2 전체다.

| 유틸리티 | px | 굵기 | 서체 | 쓰는 곳 |
|---|---|---|---|---|
| `text-display-l` | 48 / 56 | 700 | Wanted Sans | **랜딩 히어로 제목만**(키트 v3.1). 좁은 화면에서는 `text-display` |
| `text-display` | 32 / 40 | 700 | Wanted Sans | 랜딩의 구획 제목 |
| `text-lead` | 18 / 28 | 400 | Pretendard | **랜딩 히어로 문단만**(키트 v3.1) |
| `text-h1` | 24 / 32 | 700 | Wanted Sans | 페이지 제목 |
| `text-h2` | 20 / 28 | 600 | Wanted Sans | 섹션·패널 제목 |
| `text-h3` | 16 / 24 | 600 | Wanted Sans | 태스크 제목 |
| `text-body` | 15 / 24 | (상속) | Pretendard | 본문 기본. `font-semibold`를 얹으면 키트의 body-strong |
| `text-body-s` | 13 / 20 | (상속) | Pretendard | 보조 본문, 마감 줄 |
| `text-label` | 13 / 16 | 600 | Pretendard | 폼 라벨 |
| `text-caption` | 12 / 16 | 500 | Pretendard | 태그 칩, 배지, `<dt>` |
| `text-button` | 14 / 16 | 600 | Pretendard | 버튼 라벨 **전용** |

제목에는 `font-heading`을 함께 건다 — 본문 서체는 `@theme`의 `--font-sans`가 preflight를 통해 문서 전체에 이미 걸어 두므로 `<body>`에 폰트 클래스를 달지 않는다. 숫자 열에는 `.num`(`tnum`)을 쓴다.

### 간격 — 일곱 단계

키트는 `4 · 8 · 12 · 16 · 24 · 32 · 48`만 허용한다. Tailwind 4.3.3의 기본 `--spacing`이 `0.25rem`(4px)이라 **`1 2 3 4 6 8 12`가 정확히 그 일곱 단계**다. 스케일 밖 값(`1.5`·`0.5`·`5`·`10`…)은 쓰지 않는다.

간격 네임스페이스는 **일부러 리셋하지 않았다.** `--spacing: initial`로 막으면 `w-80`·`max-w-*`처럼 무관한 유틸리티까지 조용히 사라진다. 대신 사람이 지키고, 커밋 전 grep으로 확인한다.

**일곱 단계는 레이아웃 리듬의 규칙이지 컴포넌트 내부 치수의 규칙이 아니다.** 키트 자신도 배지 높이 20 · 점 6 · 좌우 패딩 9 · 체크 링 19처럼 내부 치수는 따로 정한다. 지금 스케일 밖에 있는 것은 **한 줄뿐**이고, grep 게이트를 돌리면 이것만 나와야 한다.

| 자리 | 값 | 이유 |
|---|---|---|
| `DueRing`의 `mt-0.5` | 2px | 20px 링을 행간 24px인 제목에 광학적으로 맞춘다. 4px을 주면 링이 내려앉는다 |

### 반경·그림자·모션

- 반경: `rounded-card`(14) · `rounded-control`(8, 버튼·입력창) · `rounded-full`(배지·필) · `rounded-thumb`(7).
- 🔑 **카드에 그림자를 쓰지 않는다.** 흰 표면 + `border-line` 1px이 카드다. 흰 카드는 페이지 배경과 대비가 1.1:1뿐이라 **테두리가 없으면 카드가 보이지 않는다.** `shadow-overlay`는 데스크톱 캡처 오버레이 전용이고 웹에는 아직 쓰는 곳이 없다.
- 모션: 등장 180ms `ease-enter` / 사라짐 140ms `ease-exit` / 상태 전환 150ms. `prefers-reduced-motion`에서는 `globals.css`가 전역으로 꺼 버린다.

## 컴포넌트 — `components/`

키트에는 **웹 컴포넌트 코드가 없다**(웹 산출물은 CSS 변수 파일 하나뿐). 명세를 읽고 여기서 구현했다. 전부 **서버 컴포넌트**다 — 저장소의 `"use client"`는 `app/(app)/dashboard/realtime.tsx` 하나뿐이고 그 성질을 지킨다. `clsx`·`cva` 같은 의존성을 더하지 않았다.

| 파일 | 내보내는 것 |
|---|---|
| `components/ui.tsx` | `Button`·`buttonClass`(`tone: primary\|secondary\|text\|quiet\|danger` × `size: md(36)\|sm(32)`) · `Field`·`inputClass` · `cardClass` · `Alert`·`Notice` · `SidebarLink` · `AutoBadge`·`StatusPill`(`tone: neutral\|error`)·`TagChip`·`DueRing` |
| `components/icons.tsx` | `Icon`(키트 SVG 중 실제로 쓰는 것만) · `TideLogo`·`TideSymbol` |

파일을 둘로만 나눈 것은 의도다. 여기서 하는 일은 `Record` 조회와 문자열 결합뿐이고, 그건 `app/(app)/dashboard/ui.tsx`의 `cardClass()`가 이미 쓰던 방식이다. 디렉터리를 쪼개면 파일 수가 내용보다 먼저 는다.

- **인디고로 채운 버튼은 화면(또는 카드)마다 하나만.** 두 번째 행동부터는 `secondary`·`text`·`quiet`다. 대시보드에서는 헤더의 [새 태스크]가 그 하나이고, 상세 패널은 별개의 카드라 자기 [저장]을 가질 수 있다.
- **아이콘 SVG에 `<title>`을 넣지 않는다.** `<title>`의 글자는 `textContent`에 섞여 들어가 행 전체를 보는 검증(예: "오늘 마감 행에 콜론이 한 글자도 없어야 한다")에 끼어든다. 이름이 필요하면 `aria-label`로 준다.
- **로고는 JSX로 인라인한다.** `<img>`는 ESLint `@next/next/no-img-element` 경고를 올려 `--max-warnings=0`을 깨고, `next/image`는 SVG에 설정이 더 붙는다. SVG 원본이 이미 `role="img" aria-label="Tide"`를 갖고 있어 접근 이름은 공짜다.
- **`SidebarLink`는 인디고 면 위에서 누르는 항목 전부다**(`L-P1-03`). 주요 메뉴와 태그 필터가 같은 물건을 쓴다 — 둘 다 "누르면 화면이 바뀌는 것"이고, 모양을 가르면 같은 뜻의 선택 표지가 두 벌이 된다. 무엇을 고르는 네비인지는 감싸는 `<nav>`의 `aria-label`과 사이의 구분선이 말한다.
- **`StatusPill`의 `tone="error"`는 히스토리의 실패 기록에만 쓴다**(`L-P1-03`). 필 안에 "실패"라고 이미 적혀 있고 색은 그것을 한 번 더 말한다(키트 3-5) — 색만으로 말하는 자리를 만들지 않는다.
- **아이콘은 `aria-hidden`이 기본이다.** 버튼·링크의 접근 이름은 보이는 텍스트와 `aria-label`로만 정해진다 — 아이콘이 이름에 섞이면 `getByRole("button", { name: "저장" })`이 흔들린다.

## 키트에 없어서 우리가 정한 것

키트는 데스크톱 앱 중심이라 웹에 필요한 몇 가지를 아예 다루지 않는다. 여기가 그 목록이고, 바꾸려면 이 문서를 고친다.

| 항목 | 정한 값 | 근거 |
|---|---|---|
| breakpoint | Tailwind 기본. 앱 화면은 `lg`(1024px) 하나, 랜딩만 `md`(768px)를 더 쓴다 | 랜딩의 세 칸 줄(사용법·사실 셋)이 태블릿 폭에서 먼저 펼쳐져야 한다 |
| 랜딩 구획 간격 | `py-section`(96) / 좁은 화면 `py-section-sm`(64) — `@theme`의 `--spacing-section*` | 키트의 일곱 단계는 화면 안의 리듬이다. 구획 사이는 그 최대값(48)의 두 배를 이름 하나로 판다 |
| 큰 버튼 | `buttonClass(tone, "lg")` 높이 48 | 랜딩의 다운로드 버튼만 쓴다 |
| 사이드바 폭 | `lg:w-60` (240px) | 목업(2000px @2x)에서 역산한 ≈230px에 가장 가까운 스케일 값 |
| 본문 최대 폭 | `max-w-5xl` (1024px) | 개편 전 대시보드가 쓰던 폭 그대로 — 행 길이가 검증된 값이다 |
| 페이지 거터 | 좁은 화면 `px-6`(24), 넓은 화면 `lg:px-12`(48) | 키트 간격 스케일 안의 값 |
| 포커스 링 | 인디고 2px outline + offset 2. `globals.css`의 `@layer base { :focus-visible }` **한 곳**에서만 말한다 | 키트에 없지만 **접근성상 필수**다. 컴포넌트마다 붙이면 빠뜨리는 자리가 생긴다. 브랜드색이라 화면에 새 색이 늘지 않는다 |
| 한국어 줄바꿈 | `html { word-break: keep-all; overflow-wrap: break-word }` | 브라우저 기본값이 한글을 글자 단위로 끊어 제목이 "대시 / 보드"로, 버튼이 "로그 / 아웃"으로 쪼개진다(둘 다 390px에서 실측된 적이 있다). 그때마다 `whitespace-nowrap`을 붙이는 대신 뿌리에서 고친다 |
| `<select>` | 네이티브 그대로 + `inputClass`. `appearance-none`·커스텀 셰브론을 하지 않는다 | 키트에 드롭다운 명세가 없다. 네이티브는 클라이언트 JS 0으로 키보드 조작과 모바일 휠 피커까지 준다 — 저장소의 유일한 `"use client"` 원칙과 같은 방향이다. 첫 사례는 태그 합치기(`L-P1-06`)이고 주의점 둘은 [`05-UI-Spec.md`](05-UI-Spec.md) §태그 관리 패널에 있다(빈 첫 `<option>`, `aria-label` 필수) |
| z-index | 아직 정하지 않았다 | 웹에 겹치는 층이 없다. 모달·토스트가 생기면 그때 판다 |
| 다크 모드 | **지원하지 않는다** | 키트 v3.0의 명시적 범위 밖이라 다크 팔레트가 아예 없다. `:root { color-scheme: light }`로 브라우저의 임의 반전까지 막는다 |
| 빈 상태 | 문구만. 삽화를 두지 않는다 | 문구는 `05-UI-Spec.md` §대시보드가 SSOT |
| `error.tsx`·`not-found.tsx`·`loading.tsx` | **아직 없다** | 만들면 각각 문구·동작 결정이 새로 붙는다. 필요해지는 루프에서 만든다 |
| 시각 회귀 테스트 | 도입하지 않았다 | 스냅샷 기준선이 크로스플랫폼으로 흔들린다. 대신 루프마다 1280px·390px를 눈으로 본다 |

## 브랜드

- 화면의 로고는 **Tide 워드마크**고, 제품 이름과 `<h1>`은 **Dochi/도치**다. 사용자가 키트 자산을 그대로 쓰기로 정하면서 받아들인 불일치다(2026-09-24).
- 로고 여백은 심볼 지름의 0.5배 이상, 락업 최소 높이 20px. 어두운 배경에서는 `LogoReverse`로 **바꿔 끼운다** — 색을 뒤집지 않는다.
- **Logo Pink `#F1A8C5`는 로고 안에서만** 쓴다. UI 글자·배경에 쓰지 않고 컬러 체계에도 넣지 않는다.
- 파비콘·앱 아이콘은 Next 16의 파일 컨벤션이다 — `app/icon.png`(32px) · `app/icon1.png`(256px) · `app/apple-icon.png`(256px). 키트가 *"32px 이하는 작은 크기용(파도선을 굵게)"* 을 지시하므로 32px는 키트가 small 변형에서 뽑아 둔 PNG를 쓴다(실제 렌더로 확인).

## 폰트

Pretendard(본문)와 Wanted Sans(제목) 둘 다 SIL OFL이고, **버전을 박은 jsDelivr CDN**에서 받는다. 키트에는 데스크톱용 `.otf`/`.ttf`만 있고 웹폰트가 없다. 근거와 트레이드오프는 `03-Architecture.md` §설계 결정 23.

## 커밋 전 확인 (grep 게이트)

`app/`·`components/`에서 각각 **0건**이어야 한다.

```bash
grep -rnE '\b(bg|text|border|outline|ring|fill|stroke)-(gray|zinc|slate|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]' app components   # 기본 팔레트 잔재
grep -rnE '\b(bg|text|border|outline)-\[#' app components                                                                                                                              # 임의값 색
grep -rnE '\btext-(xs|sm|base|lg|xl|[0-9]xl)\b' app components                                                                                                                         # 스케일 밖 글자 크기
grep -rnE '\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(0\.5|1\.5|2\.5|3\.5|5|7|9|10|11|14)\b' app components                                            # 스케일 밖 간격
```

- **보이는 이름** — 화면에 뜨는 문자열에 코드명(`Dochi`·`도치`)이 없어야 한다(결정 기록 10, `L-P1-13`). 주석 줄은 거른다 — 코드명은 주석과 식별자에 남는다. 0건이어야 한다.

  ```bash
  grep -rnE 'Dochi|도치' app components lib --include='*.tsx' --include='*.ts' | grep -vE '^\S+:[0-9]+:\s*(\*|//|/\*|\{/\*)'
  ```
