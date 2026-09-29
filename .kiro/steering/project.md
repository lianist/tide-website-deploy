# KIRO 작업 지침 — Tide (dochi)

이 문서는 KIRO가 이 저장소에서 작업할 때 **항상 참인 최소 규율**과 **진짜 SSOT로 가는 포인터**만 담는다.
사실을 여기 복제하지 않는다 — 상세는 항상 아래가 가리키는 원본 문서를 연다.

## 정체성 · 범위

- 패키지명 `dochi`, 브랜드 **Tide**.
- 이 저장소의 범위 = **웹 · API · 에이전트** (인증, DB, LLM 처리, 대시보드).
- 데스크톱 앱(캡처 · 전역 단축키 · 트레이 · OS 알림)은 짝 저장소 [`lianist/tide-app`](https://github.com/lianist/tide-app) 몫으로 **범위 밖**이다. 두 저장소는 격리 개발하고 HTTP API 명세만을 계약으로 삼는다.
- 스택 상세는 [`README.md`](../../README.md) 참고.

## 명령어 · 게이트

```bash
npm run dev         # next dev
npm run build       # next build
npm run lint        # eslint . --max-warnings=0
npm run typecheck   # next typegen && tsc --noEmit
npm run test        # playwright test --project=chromium
```

- 작업은 검증 가능한 단위(**루프**)로 쪼개고, 각 루프는 공통 게이트(lint · typecheck · build · test · 계약 · 기록)를 **모두** 통과해야 다음으로 넘어간다.
- **P0가 전부 끝나기 전에는 P1에 손대지 않는다.** 방법론은 [`docs/06-Loop-Engineering.md`](../../docs/06-Loop-Engineering.md).

## 절대 규칙

- **캡처 원본은 어디에도 저장하지 않는다.**
- `.env.local`·시크릿·API 키를 **커밋하지 않는다.** 키 목록은 [`.env.example`](../../.env.example).
- DB 스키마의 SSOT는 [`supabase/migrations/`](../../supabase/migrations). 대시보드에서 직접 고치지 않는다.
- **진행 상태·체크박스는 [`docs/ROADMAP.md`](../../docs/ROADMAP.md)에만** 적는다. 다른 문서에 진행 상태를 쓰면 두 곳이 갈라진다.
- 엔드포인트를 만들거나 바꾸면 **같은 커밋에서** [`docs/04-API-Contract.md`](../../docs/04-API-Contract.md)를 갱신한다(게이트 G4).
- LLM 호출은 어댑터 계층 단일 진입점(`lib/llm/openai.ts`)으로만 나간다.

## 문서 지도

무엇을 찾든 [`docs/README.md`](../../docs/README.md)가 지도다. **작업을 시작할 때는 [`docs/ROADMAP.md`](../../docs/ROADMAP.md)를 먼저 연다.**

같은 사실을 두 곳에 적지 않는다. 새로 알게 된 것을 붙이기 전에 [`docs/README.md`](../../docs/README.md)의 "어디에 적는가" 표에서 **갈 곳을 먼저 정한다.**
