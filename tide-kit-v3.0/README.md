# Tide 디자인 키트 v3.0

디자인 리소스와 Flutter 이식 파일을 한 폴더에 모았다. `tide-assets-v2.x.zip`, `tide-flutter-kit-v2.1.zip`을 대신한다.

| 폴더 / 파일 | 내용 | 누가 쓰나 |
|---|---|---|
| `design-spec.md` | 디자인 시스템 기준 문서 (브랜드, 타이포, 컬러, 컴포넌트, 알림, 아이콘) | 모두 |
| `flutter-porting-guide.md` | 데스크톱 클라이언트 구현 가이드 (넣을 위치, 창 동작, 알림 매핑, QA) | Flutter 개발 |
| `assets/brand/` | 로고 SVG 6종 (가로 락업, 심볼, 워드마크 + 반전) | 모두 |
| `assets/icons/` | UI 아이콘 SVG 12종 | 모두 |
| `assets/app-icon/` | 앱 아이콘 SVG 원본, 크기별 PNG, Windows `.ico`, macOS `.icns`·`AppIcon.appiconset` | 모두 |
| `assets/tray/` | Windows 트레이 `.ico`, macOS 메뉴바 템플릿 | Flutter 개발 |
| `web/tide-tokens.css` | 색·역할 토큰, 폰트 CSS 변수 | 웹 대시보드 |
| `flutter/` | Dart 토큰·테마·위젯, 폰트 파일, `pubspec` 스니펫 | Flutter 개발 |
| `mockups/` | 화면 목업 7장 + 컬러 시스템 시트 | 참고용 |

- 컬러: 주색 Mist `#F5F5F5`, 보조색(브랜드) Tide Indigo `#444892`. 빨강 `#CE343F`는 마감·오류 전용 기능색.
- 값이 바뀌면 `design-spec.md`를 먼저 고치고, 토큰 파일(`web/`, `flutter/lib/theme/`)을 같이 맞춘다.
