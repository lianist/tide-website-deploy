# Tide

**화면 일부를 캡처하면 에이전트가 거기서 할 일을 읽어내 태스크를 자동으로 생성·완료해 주는 서비스.**

할 일을 적는 일 자체가 일이 되는 문제를 없앤다. 입력 동선은 하나뿐이다 — **전역 단축키 → 영역 드래그 → 끝.** 확인 팝업도, 폼도 없다. 에이전트가 먼저 처리하고, 틀렸으면 사용자가 나중에 바로잡는다.

```
Ttabong (Flutter 데스크톱)
   │  ⌘단축키 → 영역 드래그
   ▼
 [HTTP] ──▶ Dochi 웹/API ──▶ Supabase (DB · Auth)
                 └────────▶ LLM 어댑터 (단일 choke point)

브라우저 대시보드 ──▶ Dochi ──▶ Supabase
```

## 이 저장소의 범위

| 저장소 | 역할 | 담당 |
|---|---|---|
| **`lianist/tide-website`** (여기) | 웹 · API · 에이전트 — 인증, DB, LLM 처리, 대시보드 | ✅ **이 저장소** |
| [`lianist/tide-app`](https://github.com/lianist/tide-app) | 데스크톱 앱 — 캡처, 전역 단축키, 트레이, OS 알림 | ❌ 범위 밖 |

둘은 **격리된 상태로 개발하고 HTTP API 명세만을 계약으로 삼는다.** 앱이 꼭 해야 하는 일(캡처·메뉴바·푸시)을 뺀 중심 기능은 전부 웹이 전담한다. 앱 관련 문서가 여기 있는 이유는 계약의 상대편을 알아야 웹을 올바르게 만들 수 있기 때문이며, 구현하지는 않는다.

## Tech Stack

| 영역 | 기술 |
|---|---|
| Web | Next.js App Router · React · TypeScript strict · Tailwind |
| Data | Supabase (`@supabase/ssr`, RLS) · Postgres 17 · `ap-northeast-2` |
| LLM | OpenAI (GPT) — 어댑터 계층 단일 진입점 |
| Test | Playwright |
| Deploy | Vercel |

## 현재 상태

**문서 단계.** 저장소 · Supabase 프로젝트 · 문서 체계만 있고 애플리케이션 코드는 아직 없다.
다음 작업은 [`docs/ROADMAP.md`](docs/ROADMAP.md)의 `L-P0-01`(Next.js 스캐폴딩)이다.

## 개발 방식

검증 가능한 단위(**루프**)로 쪼개고, 각 루프가 공통 게이트(lint · typecheck · build · test · 계약 · 기록)를 통과해야 다음으로 넘어간다. **P0가 전부 끝나기 전에는 P1에 손대지 않는다.** → [`docs/06-Loop-Engineering.md`](docs/06-Loop-Engineering.md)

## 시작하기

```bash
cp .env.example .env.local    # 값은 Supabase 대시보드 또는 패스워드 매니저에서
supabase link --project-ref etxzzpzcsojewbwtamhz
```

Supabase 프로젝트 **dochi** (org `Noti` · `ap-northeast-2` · Postgres 17) — [대시보드](https://supabase.com/dashboard/project/etxzzpzcsojewbwtamhz)

- `.env.local`은 커밋하지 않는다. 키 목록은 `.env.example` 참고.
- DB 스키마의 SSOT는 `supabase/migrations/`. 대시보드에서 직접 고치지 않는다.
- 캡처 원본은 어디에도 저장하지 않는다.

## 문서

[`docs/README.md`](docs/README.md)가 문서 지도다. 작업을 시작할 때는 [`docs/ROADMAP.md`](docs/ROADMAP.md)를 연다.
