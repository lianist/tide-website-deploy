# Tide 데스크톱 클라이언트 디자인 이식 가이드 (Flutter)

> 대상: 데스크톱 클라이언트(Flutter, macOS·Windows) 개발 · 작성: 디자인 @김주안 · 2026-09-22
> 기준 문서: `design-spec.md` v3.0 · 함께 쓰는 폴더: `tide-kit-v3.0` (이 문서가 들어 있는 폴더)
> 웹 대시보드는 이 문서 범위가 아니다. 웹은 `web/tide-tokens.css`를 쓴다.

---

## 0. 먼저 읽을 것

- 데스크톱 클라이언트가 그리는 화면은 **네 가지뿐**이다.
  1. 트레이·메뉴바 아이콘과 메뉴
  2. 캡처 영역 선택 (전체 화면 투명 창)
  3. **캡처 오버레이** (우측 하단 카드, 3단계)
  4. 권한 안내 온보딩
- 대시보드는 웹이다. 클라이언트에서 "보기"를 누르면 브라우저로 대시보드를 연다.
- **푸시 알림은 OS가 그린다.** 우리가 정하는 건 문구, 아이콘, 버튼, 이미지뿐이다(5장).
- 색·글꼴·치수 값은 코드에 직접 쓰지 말고 키트의 토큰을 쓴다. 값이 바뀌면 디자인이 스펙과 토큰 파일을 같이 고친다.
- 키트의 Dart 파일은 작성 환경에 Flutter SDK가 없어서 **컴파일하지 못했다.** 프로젝트에 넣으면 제일 먼저 `flutter analyze`를 돌려서 알려줘. 최소 버전은 Flutter 3.22(Dart 3, `WidgetState`)다.

---

## 1. 키트 구성과 넣을 위치

v3.0부터 디자인 리소스와 Flutter 이식 파일을 **`tide-kit-v3.0` 폴더 하나**로 합쳤다. `tide-assets-v2.x.zip`, `tide-flutter-kit-v2.1.zip`은 더 쓰지 않는다.

### 1-1. v2.x에서 바뀐 것
- **컬러:** 코랄을 없애고 주색(회색 Mist `#F5F5F5`)과 보조색(Tide Indigo `#444892`) 두 가지로 줄였다. Primary 버튼도 인디고다. 자세한 규칙은 3장과 `design-spec.md` 3장.
- **Dart 이름:** 색 이름이 바뀌어서 v2.1 코드는 그대로 컴파일되지 않는다. 아래 표대로 바꾼다.

| v2.1 | v3.0 |
|---|---|
| `TideColors.neutral0` ~ `neutral900` | `TideColors.primary0` ~ `primary900` (값도 바뀜) |
| `TideColors.accent*`, `success*`, `warning*`, `info*` | 없음 |
| `r.cta` / `r.ctaHover` / `r.onCta` | `r.brand` / `r.brandHover` / `r.onBrand` |
| `r.accentText` | `r.brand` |
| `r.accentDecor` (확인 필요 아이콘) | `r.attentionIcon` |
| `r.inProgressBg` / `r.inProgressText` | `r.statusBg` / `r.statusText` (회색 상태 필) |
| `r.successBg` / `r.successText` | 없음. 흰 표면 + `r.brand` 체크 아이콘 |
| `r.warningBg` / `r.warningText` | `r.statusBg` / `r.text` + `r.attentionIcon` 아이콘 |
| (새로 생김) | `r.ringIdle`, `r.brandSubtle`, `r.errorBg`, `r.errorText` |

- **에셋:** 로고·앱 아이콘·트레이 아이콘의 밝은 색을 `#F8F6F0`에서 `#F5F5F5`로 바꿨다. 모양은 같다. `.ico`, `.icns`, `AppIcon.appiconset`도 다시 만들었으니 **덮어써야 한다.**

### 1-2. 폴더 구성과 넣을 위치

| 폴더 경로 | 프로젝트 위치 | 설명 |
|---|---|---|
| `flutter/lib/theme/tide_colors.dart` | `lib/theme/` | 톤 스케일 원본 값 (`TideColors.secondary600` 등) |
| `flutter/lib/theme/tide_roles.dart` | `lib/theme/` | 역할 토큰 `ThemeExtension` (`TideRoles.of(context).brand`) |
| `flutter/lib/theme/tide_type.dart` | `lib/theme/` | 타입 스케일 (`TideType.h1`, `TideType.bodyS`) |
| `flutter/lib/theme/tide_metrics.dart` | `lib/theme/` | 간격, 모서리, 크기, 오버레이 치수, 모션 시간 |
| `flutter/lib/theme/tide_theme.dart` | `lib/theme/` | `buildTideTheme()` — `MaterialApp(theme: buildTideTheme())` |
| `flutter/lib/widgets/tide_auto_badge.dart` | `lib/widgets/` | '자동' 배지 예시 위젯 |
| `flutter/fonts/*.otf, *.ttf` + OFL | `fonts/` | Pretendard 4종, Wanted Sans 2종, 라이선스 |
| `flutter/pubspec_fonts.yaml` | `pubspec.yaml`에 병합 | 폰트·에셋 선언 |
| `assets/brand/*.svg` | `assets/brand/` | 로고 (가로 락업, 심볼, 워드마크 + reverse) |
| `assets/icons/*.svg` | `assets/icons/` | UI 아이콘 12종 |
| `assets/tray/*` | `assets/tray/` | 트레이·메뉴바 아이콘 |
| `assets/app-icon/tide.ico` | `windows/runner/resources/app_icon.ico` | Windows 앱 아이콘 (**이름을 바꿔서** 덮어쓰기) |
| `assets/app-icon/macos/AppIcon.appiconset/` | `macos/Runner/Assets.xcassets/AppIcon.appiconset/` | macOS 앱 아이콘 (폴더째 덮어쓰기) |

- `assets/brand`, `assets/icons`, `assets/tray`는 폴더 이름이 프로젝트와 같아서 그대로 복사하면 된다.
- Flutter 프로젝트에 넣지 않아도 되는 것: `assets/app-icon/*.svg`·`png/`·`tide.icns`(원본), `web/tide-tokens.css`(웹용), `mockups/`(참고용).

---

## 2. 폰트

- **Pretendard**는 본문과 UI 전부에 쓴다(400·500·600·700). **Wanted Sans**는 제목에만 쓴다(600·700).
- OS 폰트에 기대지 말고 **앱에 번들한다.** Windows 기본 한글 폰트(맑은 고딕)와 macOS 기본(Apple SD 산돌고딕 Neo)은 모양과 폭이 달라서 두 OS의 카드 높이가 달라진다.
- 가변 폰트 대신 정적 폰트를 쓴다. `fontWeight`만으로 굵기가 확실히 적용된다.
- 용량은 6개에 약 11MB다. 한글 전체 글자가 필요해서(태스크 이름은 사용자가 쓴 아무 글자나 올 수 있다) 서브셋은 하지 않는다.
- CSS 값을 옮기는 규칙은 `tide_type.dart`에 이미 반영했다.
  - `height` = 행간 ÷ 글자 크기
  - `letterSpacing` = em × 글자 크기 (Flutter는 em이 아니라 논리 픽셀을 받는다)
  - `leadingDistribution: TextLeadingDistribution.even`으로 CSS와 같은 수직 정렬을 맞춘다
- 숫자(개수, 시간)는 `TideType.caption.merge(TideType.tabular)`처럼 고정폭 숫자로 정렬한다.

---

## 3. 색 쓰는 법

- 색은 **주색(회색)과 보조색(인디고) 두 가지**다. 빨강(`error`)은 마감 당일·지남과 오류에만 쓰는 기능색이다.
- 화면 코드에서는 **역할 토큰**을 쓴다: `final r = TideRoles.of(context);` → `r.brand`, `r.text`, `r.autoBg`.
- Material 이름 대응 (`buildTideTheme()`에 이미 들어 있다):

| Material | Tide | 값 |
|---|---|---|
| `colorScheme.primary` / `secondary` | 보조색 Tide Indigo. 강조색을 따로 두지 않아서 둘 다 인디고다 | `secondary-600 #444892` |
| `scaffoldBackgroundColor` | 주색 Mist | `primary-100 #F5F5F5` |
| `colorScheme.surface` | 카드·오버레이 | `primary-0 #FFFFFF` |
| `colorScheme.error` | 마감 당일·지남, 오류 | `error-600 #CE343F` |
| `FilledButton` | Primary 버튼 | 채움 `secondary-600`, hover `secondary-700` |
| `OutlinedButton` | Secondary 버튼 | 흰 채움, `primary-300` 테두리 |
| `TextButton` | Text 버튼 (보기, 되돌리기) | `secondary-600` 글자 |
| `TextButton` + `foregroundColor: r.textSecondary` | Quiet 버튼 (닫기, 나중에 하기) | `primary-600` 글자 |

- **지켜야 할 규칙**
  - 인디고로 채운 버튼은 화면(또는 카드) 하나에 **최대 1개**.
  - 사용자가 행동할 곳은 **진한 인디고**(`r.brand` 채움, `r.attentionText`), 에이전트가 한 일은 **옅은 인디고**(`r.autoBg` / `r.autoText`)다. 둘 다 인디고라서 모양으로도 구분한다: 확인 필요는 아이콘이 붙은 배너, '자동'은 점이 붙은 작은 배지.
  - `primary-500` 이하는 본문 글자에 쓰지 않는다. `secondary-400` 이하는 글자에 쓰지 않는다.
  - 흰 카드는 회색 배경과 대비가 약하다(1.1:1). 카드에는 **항상 `r.border` 테두리**를 두른다.
  - 상태는 **색만으로 구분하지 않는다.** 항상 아이콘이나 문구를 같이 둔다.
- 다크 모드는 v3.0 범위가 아니다. 오버레이 카드는 OS가 다크 모드여도 흰 카드로 둔다.

---

## 4. 캡처 오버레이

목업: `mockups/Tide_4_overlay_v3.png` (① 분석 중 · ② 자동 반영됨 · ③ 확인 필요)

### 4-1. 창 구성

**창을 따로 만들지 말고 메인 창 하나를 상태에 따라 바꿔 쓰는 걸 추천한다.** 클라이언트는 트레이 상주 앱이라 평소엔 창이 숨겨져 있다.

| 상태 | 창 크기·위치 | 비고 |
|---|---|---|
| 대기 | 숨김 | 트레이·메뉴바 아이콘만 보인다 |
| 영역 선택 | 캡처하는 모니터 전체, 투명 | 단축키를 누른 순간 커서가 있는 모니터 |
| 오버레이 | 카드 크기 + 그림자 여백(`TideOverlay.shadowBleed` 24px) | 작업 영역 오른쪽·아래에서 16px |
| 온보딩 | 660 × 440, 화면 가운데 | 처음 실행할 때, 권한이 빠졌을 때만 |

- Flutter 공식 멀티 윈도우 API는 2026년 9월 기준 main 채널 실험 기능이다. 창을 두 개 이상 써야 하면 `desktop_multi_window`를 쓰되, 창마다 엔진이 따로 떠서 메모리와 시작 시간이 늘어나는 걸 감안한다.
- 창 속성은 대부분 `window_manager`로 설정한다: 테두리 없음, 배경 투명, 항상 위, 작업 표시줄 숨김, 크기 조절 금지. 모니터와 작업 영역은 `screen_retriever`로 구한다.
- 트레이·메뉴바는 `tray_manager`(또는 `system_tray`), 전역 단축키는 `hotkey_manager`를 쓴다. 패키지 버전은 착수할 때 pub.dev에서 다시 확인한다.

### 4-2. 반드시 지킬 창 동작 (네이티브 코드 필요)

패키지만으로는 해결되지 않는다. **착수 첫 주에 PoC로 먼저 검증해줘.** 여기서 막히면 디자인을 바꿔야 한다.

| 요구 | Windows | macOS |
|---|---|---|
| **포커스를 뺏지 않는다.** 사용자가 타이핑 중이어도 입력이 끊기면 안 된다 | 확장 스타일 `WS_EX_NOACTIVATE`·`WS_EX_TOOLWINDOW`, 표시는 `SW_SHOWNOACTIVATE` | `MainFlutterWindow`를 `NSPanel`로 바꾸고 `.nonactivatingPanel` |
| 모든 앱 위에 뜬다 | `WS_EX_TOPMOST` (`setAlwaysOnTop`) | `level = .floating` 이상 |
| 전체 화면 앱·다른 데스크톱 위에서도 보인다 | 기본 동작 확인 | `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]` |
| 작업 표시줄·Dock·Alt+Tab에 안 나온다 | `WS_EX_TOOLWINDOW` | Info.plist `LSUIElement = true` (메뉴바 앱) |
| 둥근 모서리와 그림자 | 창은 투명, 카드·그림자는 Flutter가 그린다 | 같음. `hasShadow = false`, `isOpaque = false` |

- 투명 창에서 그림자가 잘리지 않도록 창을 카드보다 사방 24px 크게 잡는다. 그 여백 영역은 **클릭이 뒤로 통과**하게 한다. 안 되면 여백을 최소로 줄이고 그림자를 약하게 한다.
- 위치는 캡처한 모니터의 **작업 영역**(작업 표시줄·Dock·메뉴바를 뺀 영역) 기준이다. Windows 작업 표시줄이 위나 옆에 있을 수도 있다.
- 창을 미리 만들어 숨겨두고 보여주기만 한다. 단축키 → 카드 표시까지 0.5초 안이 목표다.

### 4-3. 카드 치수 (`TideOverlay`, `TideSize`)

| 항목 | 값 |
|---|---|
| 카드 폭 | 320px (목업 290px에서 한글 여유를 위해 넓힘) |
| 안쪽 여백 | 위 16 · 좌우 18 · 아래 12 |
| 모서리 | 14px (`TideRadius.card`) |
| 배경 / 테두리 | `r.bgSurface` / `r.border` 1px |
| 그림자 | `TideOverlay.shadow` (인디고 기운 18% 블러 24 + 8% 블러 4). 다른 앱 위에 떠 있는 창이라 스펙의 '그림자 없음'에서 예외다 |
| 제목 | `TideType.h3` 크기 15px로 조정 (Wanted Sans 600) |
| 태스크 이름 | `TideType.bodyStrong` |
| 보조 글자 | `TideType.bodyS` + `r.textSecondary` |
| 구분선 위 여백 | 14px, 구분선 아래 버튼 줄 높이 44px |
| 버튼 | `TideSize.buttonHeightCompact` 32px |
| 진행 바 | 4px, 트랙 `r.bgSubtle`, 채움 `r.brand` |
| 되돌리기 타이머 바 | 카드 맨 아래 3px, `r.undoTimer`, 오른쪽에서 왼쪽으로 줄어든다 |

### 4-4. 상태별 동작

| 상태 | 내용 | 버튼 | 언제 사라지나 |
|---|---|---|---|
| ① 분석 중 | 캡처 썸네일 + "태스크를 찾는 중…" + 진행 바 + "화면은 계속 쓰셔도 됩니다" | 없음 | 결과가 오면 ②나 ③으로 바뀐다 |
| ② 자동 반영됨 | '자동' 배지 + 결과 문구 + 태스크 이름·마감 | Text "되돌리기" · Primary "보기" | 6초 뒤 자동으로 닫힌다 |
| ③ 확인 필요 / 실패 | 경고 아이콘(`r.attentionIcon`) + "태스크를 확정하지 못했어요" + 안내 | Quiet "닫기" · Primary "지금 확인" | 사용자가 닫거나 확인할 때까지 남는다 |

- **진행 바:** 실제 진행률을 알 수 없으니 10초 동안 0 → 90%까지 감속 곡선으로 채우고, 결과가 오면 100%로 채운 뒤 바꾼다. 10초가 지나면 ③으로 넘긴다(PRD 가정 4).
- **되돌리기 6초:** 카드에 마우스를 올리면 타이머를 멈추고, 내리면 이어간다. 되돌리기를 누르면 "되돌렸어요" 문구를 1.5초 보여준 뒤 닫는다.
- **다음 캡처가 들어오면** 같은 자리에서 새 카드로 교체한다. 카드를 쌓지 않는다.
- **모션:** 아래에서 8px 올라오며 180ms(`easeOutCubic`)로 나타나고, 140ms로 사라진다. 상태 전환은 150ms 크로스페이드다. OS의 '동작 줄이기'가 켜져 있으면(`MediaQuery.disableAnimations`) 이동 없이 페이드만 쓴다.
- **스크린 리더:** 상태가 바뀔 때 `Semantics(liveRegion: true)`로 제목을 읽어준다.
- **키보드:** 포커스를 받지 않는 창이라 키 입력을 못 받는다. 되돌리기 단축키가 필요하면 전역 단축키로 따로 잡아야 한다. PRD의 단축키 목록에 없으니 기획과 정할 항목이다.

---

## 5. 푸시 알림 (OS 네이티브)

목업: `mockups/Tide_push_windows_v3.png`, `mockups/Tide_push_macos_v3.png`

### 5-1. 오버레이와 푸시의 역할 나누기

| 상황 | 채널 |
|---|---|
| 사용자가 방금 캡처함 (결과를 기다리는 중) | **오버레이만.** 같은 건으로 OS 알림을 또 보내지 않는다 |
| ③ 확인 필요 카드를 확인하지 않고 닫음, 또는 결과가 나올 때 화면이 잠겨 있음 | OS 알림으로 넘긴다 (알림 센터에 남도록) |
| 사용자가 캡처하지 않았는데 에이전트가 바꾼 것 (P1 상태 변경, P2 메일 연동) | OS 알림, **5분 묶음** |
| 추출 실패·확인 필요 | OS 알림, **묶지 않는다** |

- 비동기 알림을 커스텀 창으로 흉내 내지 않는다. 방해 금지·집중 모드를 무시하게 되고 알림 센터에 기록도 남지 않는다.

### 5-2. 알림 종류와 문구

| 종류 | 제목 | 본문 | 출처 줄 (Win) / 본문 둘째 줄 (Mac) | 이미지 | 버튼 (기본 클릭) |
|---|---|---|---|---|---|
| 1건 추가 | 태스크 1건을 추가했어요 | {태스크 이름} · {마감} | 캡처에서 자동 생성 | 없음 | 보기 (기본) · 되돌리기 |
| 묶음 | 태스크 {n}건이 반영됐어요 | 추가 {a}건 · 상태 변경 {b}건 | 자동 반영 · 대시보드에서 하나씩 되돌릴 수 있어요 | 없음 | 모두 보기 (기본) |
| 확인 필요 | 확인이 필요한 캡처가 있어요 | 캡처를 '확인 필요'에 보관했어요 | 없음 | 캡처 썸네일 | 지금 확인 (기본) · 나중에 |

- 제목은 **한 줄(한글 20자 안팎)** 안에서 끝낸다. 태스크 이름이 길면 본문에서 말줄임한다(30자).
- 말투는 UI와 같은 해요체다. 결과를 먼저 쓴다.
- '자동' 배지는 알림에 넣을 수 없어서 **출처 줄 문구**가 그 역할을 한다.
- **macOS는 기본 상태에서 버튼이 안 보인다.** 마우스를 올려야 '옵션' 메뉴가 나온다. 그래서 알림 본문 클릭 = 주 행동(보기 / 지금 확인)으로 꼭 연결한다.
- 묶음 규칙: 5분 창에서 첫 변경은 바로 보내고, 이후 변경은 같은 알림을 교체해서 숫자만 올린다. 5분 동안 변경이 없으면 창을 닫는다.

### 5-3. 구현 매핑

| 항목 | Windows (토스트) | macOS (UserNotifications) |
|---|---|---|
| 패키지 | `flutter_local_notifications` (Windows 구현 포함) | `flutter_local_notifications` (Darwin) |
| 앱 이름·아이콘 | 등록된 앱 이름과 `app_icon.ico` | 앱 번들 AppIcon |
| 제목 / 본문 | `<text>` 1·2번째 | `title` / `body` |
| 출처 줄 | `<text placement="attribution">` | `body` 둘째 줄로 합친다 |
| 이미지 | 인라인 `<image>` | `attachments` (썸네일) |
| 버튼 | `<action>` 최대 2개, 왼쪽이 주 행동 | `UNNotificationCategory` actions |
| 묶음 교체 | `tag = "batch"`, `group = "changes"` | 같은 `identifier`로 다시 보내면 교체, `threadIdentifier = "changes"` |
| 누른 뒤 처리 | 버튼 `arguments`로 행동 구분 → 대시보드 딥링크 열기 | `actionIdentifier`로 구분 |

- **Windows는 MSIX 패키징을 전제로 한다.** 패키지 정체성(package identity)이 없으면 이미 보낸 알림을 조회·취소할 수 없어서 묶음 교체와 되돌린 뒤 알림 지우기가 제대로 안 된다(`flutter_local_notifications_windows` 문서). 배포는 `msix` 패키지로 만든다.
- 앱이 꺼져 있을 때 버튼을 누르는 경우도 처리해야 한다. 상주 앱이라 드물지만, 앱을 다시 띄워서 해당 행동을 실행한다.
- 알림 권한을 거부하면 알림 없이도 동작해야 한다. 확인 필요 건은 트레이 아이콘 메뉴의 "확인 필요 {n}건"으로 들어갈 수 있게 한다.

---

## 6. 아이콘

### 6-1. 앱 아이콘
- **32px 이하는 작은 크기용**(`tide-app-icon-small.svg`)을 쓴다. 파도선을 굵게 하고 두 줄 간격을 넓혀서 16px에서도 두 줄이 구분된다. **48px 이상은 기본 아이콘**을 쓴다.
- Windows `app_icon.ico`에는 16·20·24·32(작은 크기용)와 40·48·64·256(기본)이 들어 있다. 작업 표시줄, 알림, 탐색기가 알아서 맞는 크기를 고른다.
- macOS `AppIcon.appiconset`은 macOS 규격(1024 캔버스 안 824 본체, 여백·그림자)으로 만들었다. Dock에서 다른 앱 아이콘과 크기가 맞는다.

### 6-2. 트레이·메뉴바
| OS | 파일 | 규칙 |
|---|---|---|
| Windows | `tide-tray.ico` (16·20·24·32) | 컬러 앱 아이콘. 다크·라이트 작업 표시줄 모두에서 보인다 |
| macOS | `tide-menubar-template.png` / `@2x` | 검정 + 투명만 있는 **템플릿 이미지**. `isTemplate`을 켜면 다크 모드에서 OS가 흰색으로 바꾼다. 18pt |

- 확인 필요 건이 있으면 트레이 아이콘에 점을 찍는 대신 **메뉴 첫 줄에 "확인 필요 {n}건"**을 둔다. 템플릿 이미지에는 색 점을 넣을 수 없다.

### 6-3. UI 아이콘
- `assets/icons/tide-icon-*.svg` 12종: 24px 그리드, 선 1.8, `currentColor`.
- `flutter_svg`로 그리고 색은 `colorFilter: ColorFilter.mode(color, BlendMode.srcIn)`로 입힌다.
- `check-circle`은 안쪽 체크가 흰색으로 고정돼 있어서 `srcIn`을 쓰면 체크가 사라진다. 이 아이콘만 색을 입히지 말고 원본으로 쓰거나, 원 + 체크를 위젯으로 따로 그린다.

---

## 7. 권한 온보딩

목업: `mockups/Tide_2_permission_v3.png`

- 660 × 440 창, 화면 가운데, 일반 창(포커스를 받는다)이다.
- 두 권한의 상태를 **앱이 다시 켜져도** 이어서 보여준다. 허용 여부는 실행할 때마다 OS에 다시 물어서 확인한다.
- "지금 허용"은 Primary(인디고) 버튼, 허용된 항목은 인디고 채움 체크 + "허용됨", "나중에 하기"는 Quiet 버튼이다.
- 설정 경로 안내는 OS별로 문구를 바꾼다.
  - macOS: 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록 / 손쉬운 사용
  - Windows: 화면 기록 권한 절차가 없으면 해당 줄을 숨기고 1단계만 보여준다. 개발에서 확인한 실제 절차에 맞춰 디자인이 문구를 고친다.

---

## 8. QA 체크리스트

**오버레이**
- [ ] 메모장·Word에 타이핑하는 중에 캡처해도 커서와 입력이 끊기지 않는다
- [ ] 전체 화면 앱(영상, 발표) 위에서도 카드가 보인다 (macOS 전체 화면 데스크톱 포함)
- [ ] 모니터 2대에서 캡처한 쪽 모니터 우측 하단에 뜬다. 배율이 100%와 150%로 달라도 위치가 맞다
- [ ] Windows 작업 표시줄을 위·왼쪽으로 옮겨도 카드가 가려지지 않는다
- [ ] 그림자 여백 영역을 클릭하면 뒤의 창이 클릭된다
- [ ] 되돌리기 타이머가 마우스를 올리면 멈추고, 내리면 이어진다
- [ ] 10초가 지나면 ③으로 바뀐다
- [ ] 연속으로 캡처하면 카드가 쌓이지 않고 교체된다
- [ ] '동작 줄이기'를 켜면 이동 애니메이션이 없어진다

**알림**
- [ ] 캡처한 건은 오버레이만 뜨고 OS 알림이 중복으로 오지 않는다
- [ ] 5분 안의 변경 3건이 알림 1개로 합쳐지고 숫자만 바뀐다 (Windows MSIX 빌드에서 확인)
- [ ] 확인 필요 알림은 묶이지 않고 건마다 온다
- [ ] 방해 금지·집중 모드에서는 알림이 배너로 뜨지 않고 알림 센터에만 쌓인다
- [ ] macOS에서 알림 본문을 누르면 대시보드가 열린다 (버튼을 안 눌러도)
- [ ] 알림 권한을 거부해도 트레이 메뉴에서 확인 필요 건으로 들어갈 수 있다

**브랜드**
- [ ] 16px 트레이·작업 표시줄에서 파도 두 줄이 구분된다
- [ ] macOS 메뉴바 아이콘이 다크 모드에서 흰색으로 바뀐다
- [ ] 한글이 Pretendard·Wanted Sans로 나온다. 시스템 폰트로 대체되면 안 된다
- [ ] 인디고 채움 버튼이 카드마다 1개 이하다
- [ ] 화면에 회색·인디고·(마감·오류의) 빨강 말고 다른 색이 없다. 로고의 핑크 파도선만 예외다

---

## 9. 디자인과 정할 것

- 되돌리기 전역 단축키를 둘지 (PRD 단축키 목록에 없다)
- Windows에서 화면 기록 권한 단계가 실제로 필요한지 → 온보딩 1단계 구성
- 네이티브 창 동작(4-2) PoC 결과. 포커스를 안 뺏는 투명 창이 안 되면 카드 디자인을 불투명 사각형 기준으로 다시 잡는다
