# 문서 지도

Dochi 문서는 **한 가지 질문에 한 문서만 답한다.** 같은 사실을 두 곳에 적지 않는다.

## 무엇을 찾을 때 어디를 여는가

| 질문 | 문서 |
|---|---|
| **지금 뭘 해야 하지?** | [`ROADMAP.md`](ROADMAP.md) ← **여기서 시작** |
| 왜 이걸 만들지? 이 결정은 왜 이렇게 됐지? | [`00-Product.md`](00-Product.md) |
| 이걸 뭐라고 불러야 하지? | [`01-Glossary.md`](01-Glossary.md) |
| `AGT-6`이 정확히 뭘 요구하지? | [`02-Requirements.md`](02-Requirements.md) |
| 이 코드는 어디에 놓지? 경계를 넘나? | [`03-Architecture.md`](03-Architecture.md) |
| 앱이 뭘 보내고 뭘 받지? | [`04-API-Contract.md`](04-API-Contract.md) |
| 이 화면에 뭐가 보여야 하지? | [`05-UI-Spec.md`](05-UI-Spec.md) |
| 이 작업을 어떻게 쪼개고 검증하지? | [`06-Loop-Engineering.md`](06-Loop-Engineering.md) |
| 에이전트 프롬프트를 어떻게 쓰지? | [`07-Prompt-Principles.md`](07-Prompt-Principles.md) |
| 이 색·글자 크기·간격·컴포넌트를 어떻게 고르지? | [`08-Design-System.md`](08-Design-System.md) |
| 앱 부서에 뭘 알려야 하지? 어디까지 알렸지? | [`09-App-Handoff.md`](09-App-Handoff.md) |
| 원래 기획에 뭐라고 적혀 있었지? | [`original/`](original/) |

## 어디에 적는가

새로 알게 된 것을 붙이기 전에 **갈 곳을 먼저 정한다.**

| 알게 된 것 | 갈 곳 |
|---|---|
| 작업이 끝났다 / 막혔다 | `ROADMAP.md` 상태 갱신 |
| 왜 이렇게 하기로 했다 (제품) | `00-Product.md` §결정 기록 |
| 왜 이렇게 하기로 했다 (기술) | `03-Architecture.md` §설계 결정 |
| 엔드포인트를 만들었다/바꿨다 | `04-API-Contract.md` (**같은 커밋에서** — 게이트 G4) |
| 새 용어를 쓰기 시작했다 | `01-Glossary.md` |
| 토큰·컴포넌트를 더하거나 바꿨다 | `08-Design-System.md` (값 자체는 **키트의 `design-spec.md`를 먼저** 고친다) |
| 요구사항이 바뀌었다 | `02-Requirements.md` + `ROADMAP.md` 양쪽 |
| 앱이 알아야 할 변경이 생겼다 | 다음 전달분 파일 `handoff/<날짜>.md`에 절 추가 + `09-App-Handoff.md` 전달 현황 표에 한 줄 (전달 **여부**는 그 표가 관리한다) |
| 매 세션 참인 사실, "항상 X 하라" | 루트 `CLAUDE.md` |

**체크박스는 `ROADMAP.md`에만 만든다.** 다른 문서에 진행 상태를 적으면 두 곳이 갈라진다.

## 원본 아카이브

[`original/`](original/) 의 4개 파일은 2026-09-20 문서 재개편 이전의 기획 원본이다. **읽기 전용 — 수정하지 않는다.** 현재 문서와 다르면 현재 문서가 맞다.

| 원본 | 흡수된 곳 |
|---|---|
| `overview.md` | `00-Product.md` |
| `glossary.md` | `01-Glossary.md` |
| `functions.md` | `02-Requirements.md` (요구사항) + `00-Product.md` (결정 기록·이슈·Non-goals) |
| `pages.md` | `05-UI-Spec.md` |
