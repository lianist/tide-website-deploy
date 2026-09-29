# 03 — 아키텍처

> **어떻게 만드는가**의 SSOT. 경계가 흔들리면 여기부터 고친다.
> 무엇을 만드는가는 [`02-Requirements.md`](02-Requirements.md), 엔드포인트 세부는 [`04-API-Contract.md`](04-API-Contract.md).

## 제품 구성

두 저장소가 하나의 제품을 이룬다.

| 저장소 | 역할 | 스택 | 이 세션의 범위 |
|---|---|---|---|
| `lianist/tide-website` (이 저장소) | **웹 · API · 에이전트** — 인증, DB, LLM 처리, 대시보드 | Next.js + Supabase | ✅ **우리가 만든다** |
| `lianist/tide-app` | **데스크톱 앱** — 캡처, 전역 단축키, 트레이, OS 알림 | Flutter (macOS 우선) | ❌ 범위 밖 |

**둘은 격리된 상태로 개발한다.** 유일한 접점은 HTTP API 명세다(`API-1`). 앱이 꼭 해야 하는 일(캡처·메뉴바·푸시)을 뺀 나머지 중심 기능은 전부 웹이 전담한다.

```
Ttabong (Flutter)
   │  ⌘단축키 → 영역 드래그 → 이미지 + 모드 + 캡처시각 + 시간대
   ▼
 [HTTP] POST /api/captures ─────────▶ Dochi Route Handler
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
                 LLM 어댑터          Supabase DB         job_logs 기록
              (단일 choke point)   (tasks · tags)        (AGT-8)
                       │
                  캡처 이미지는 여기서 끝난다 — 저장하지 않음 (AGT-10)
                       │
   ◀───────────────────┘  { data: { jobLogId, created[], completed, failure } }
   │
   └─▶ 앱이 이 응답만으로 OS 알림 구성 (NTF-1)

브라우저 대시보드 ──▶ Dochi (Server Component / Route Handler) ──▶ Supabase
                └──▶ Supabase Realtime 직접 구독 (RLS 하에서, DASH-5)
```

## 경계 (이 다섯 줄이 규칙이다)

1. **앱은 Supabase를 직접 호출하지 않는다.** Ttabong은 Dochi가 노출하는 HTTP API만 쓴다(`API-1`).
   → 인증·RLS·LLM 키가 한 곳에 모이고, 클라이언트에 비밀이 실리지 않는다.
2. **LLM 호출은 단일 choke point를 지난다.** `lib/llm/` 밖에서 SDK를 직접 import 하지 않는다.
   → 토큰·지연·모델을 항상 계측해 저장할 수 있다.
3. **DB 스키마의 SSOT는 `supabase/migrations/`다.** 대시보드에서 손으로 고치지 않는다. 생성된 타입은 손으로 수정하지 않는다.
4. **비즈니스 로직은 서버에만 둔다**(`API-5`). 앱과 웹에 같은 로직을 중복 구현하지 않는다.
5. **캡처 원본은 어디에도 저장하지 않는다**(`AGT-10`). Storage 버킷도, 로그도, 임시 파일도 아니다.

## 기술 스택

버전은 `L-P0-01`(2026-09-20)에 **정확 버전으로 고정**했다. 캐럿(`^`)을 쓰지 않는 이유는 게이트가 "어제는 통과했는데 오늘 깨짐"을 겪지 않게 하기 위해서다. 올릴 때는 의도적으로 올린다.

| 영역 | 기술 | 비고 |
|---|---|---|
| Web | `next` 16.3.5 · `react`/`react-dom` 19.3.0 · TypeScript strict · `tailwindcss`/`@tailwindcss/postcss` 4.3.3 | App Router · Turbopack(Next 16 기본) · `src/` 미사용. Tailwind는 **v4 CSS-first**라 `tailwind.config.*`가 없다 — 토큰은 `app/globals.css`의 `@theme`가 SSOT다(§설계 결정 23) |
| Design | **Tide 디자인 키트 v3.0** (`tide-kit-v3.0/`) · 웹폰트 Pretendard `v1.3.9` · Wanted Sans `v1.0.3` (jsDelivr, 주소에 버전 고정) | 색·타이포·컴포넌트 명세의 상위 SSOT는 키트의 `design-spec.md`. 웹 적용 규칙은 [`08-Design-System.md`](08-Design-System.md) |
| Data | `@supabase/supabase-js` 2.116.0 · `@supabase/ssr` 0.12.7 · RLS · 신규 키 `sb_publishable_`/`sb_secret_` · Postgres 17 · region `ap-northeast-2` · org `Noti` | L-P0-02에서 고정. `@supabase/ssr`은 쿠키 기반 세션용 — `lib/supabase/server.ts`와 `proxy.ts`가 쓴다(§설계 결정 10) |
| LLM | **OpenAI (GPT)** — `openai` 7.21.0 · 모델 `gpt-5.6-luna`(게이트웨이 env가 있으면 `bedrock-gpt-5.6-sol`) · 어댑터 계층(`lib/llm/`) 뒤 | L-P0-07에서 고정. 모델을 고른 근거·가격·실측은 아래 §설계 결정 4. **기억에 의존하지 않는다** |
| Test | `@playwright/test` 1.63.0 (E2E·UI + API 요청 테스트) | 러너는 **하나뿐**. API는 Playwright의 `request` fixture로 친다 |
| Deploy | Vercel | |

### 버전이 최신이 아닌 것들 — 되돌리기 전에 읽을 것

레지스트리 최신을 일부러 피한 세 건이다. **셋 다 실제로 깨져서 내린 것**이고, 이유를 모르면 다음 세션이 "최신으로 올리자"며 되돌린다.

| 패키지 | 고정 | 최신 | 최신을 쓰지 않는 이유 |
|---|---|---|---|
| `eslint` | **9.39.5** | 10.11.0 | `eslint-config-next`가 끌고 오는 `eslint-plugin-import`(peer `^9`)·`eslint-plugin-react`(`^9.7`)·`eslint-plugin-jsx-a11y`(`^9`)가 아직 ESLint 10을 열지 않았다. 10을 쓰면 설치가 ERESOLVE로 깨진다. `npm install` 시 "no longer supported" 경고가 뜨지만 **`--legacy-peer-deps`로 뭉개지 않는다** — 게이트를 세우는 자리에서 게이트를 우회하는 셈이다. 마지막 관문은 `eslint-plugin-react` |
| `typescript` | **6.0.3** | 7.0.2 | TS 7(Go 네이티브 컴파일러)은 `typescript-eslint@8.70.0`의 peer `>=4.8.4 <6.1.0` 밖이다. 6.0.3이 호환 범위 안의 최신 |
| `@types/node` | **22.20.4** | 26.x | 런타임 Node 22에 맞춘다 |

### 검증 명령이 이렇게 생긴 이유

| 스크립트 | 실제 명령 | 비자명한 부분 |
|---|---|---|
| `lint` | `eslint . --max-warnings=0` | Next 16에서 **`next lint`는 제거**됐다(`eslint.config.mjs` flat config로 이전). `--max-warnings=0`이 없으면 warning만 있을 때 exit 0이라 G1의 "경고 0"이 검사되지 않는다 — `@typescript-eslint/no-unused-vars`가 warn 등급이라 실제로 새는 구멍이다 |
| `typecheck` | `next typegen && tsc --noEmit` | `next-env.d.ts`는 gitignore 대상(Next 공식 권장)이라 신규 클론에 없고, 없으면 `import "./globals.css"`가 TS2307로 깨진다. `next typegen`이 빌드 없이 이 파일과 라우트 타입을 만든다. ⚠️ `next typegen`은 `next.config.ts`를 **production build phase로 로드**한다 — 설정에서 필수 env를 읽게 만들면 typecheck가 거기서 죽는다 |
| `test` | `playwright test` | dev 서버는 `playwright.config.ts`의 `webServer`가 직접 띄운다. `reuseExistingServer`가 켜져 있어 이미 띄워 둔 서버가 있으면 재사용한다. ⚠️ **Playwright는 Next과 달리 `.env.local`을 스스로 읽지 않는다** — DB를 치는 테스트를 위해 설정 파일 맨 위에서 `process.loadEnvFile()`로 한 번 읽는다(L-P0-02) |
| `db:types` | `supabase gen types typescript --linked …` | **원격 스키마**에서 `lib/supabase/database.types.ts`를 다시 뽑는다. `db push` 뒤에 항상 돌린다. 게이트는 아니지만 안 돌리면 typecheck가 옛 스키마를 믿는다 |

`start`는 두지 않았다 — 배포는 Vercel이고 테스트는 dev 서버를 쓴다. 프로덕션 기동 검증이 필요해지는 `L-P0-14`에서 추가한다.

Playwright **브라우저 바이너리는 저장소가 아니라 머신 상태**다. 새 머신에서는 `npx playwright install chromium`을 1회 실행해야 `npm run test`가 돈다. 브라우저는 chromium 하나만 쓴다 — 대상이 데스크톱 대시보드고 크로스브라우저는 P0 완주 조건이 아니다.

> `next dev`는 루트 `CLAUDE.md` 끝에 `<!-- BEGIN:nextjs-agent-rules -->` 블록을 **자동으로 붙인다**(`node_modules/next/dist/server/lib/generate-agent-files.js`). 지워도 다음 `next dev`에 되살아나므로 커밋에 포함해 트리를 깨끗하게 둔다.

## 데이터 스키마

**SSOT는 `supabase/migrations/20260920141904_initial_schema.sql`이다.** 아래는 그 요약이며, 다르면 마이그레이션이 맞다. 스키마를 바꿀 때는 새 마이그레이션을 쓰고 `npm run db:types`로 타입을 다시 뽑는다.

| 테이블 | 핵심 컬럼 | 메모 |
|---|---|---|
| `profiles` | `id`(= `auth.users.id`), `timezone`, `created_at` | `AGT-4`의 상대 날짜 환산에 `timezone`이 필요하다. 앱은 캡처마다 시간대를 보내지만(`API-3`) 메일 소스(P2)에는 보낼 앱이 없다. 행은 가입 트리거가 만든다(§설계 결정 11) |
| `tasks` | `id`, `user_id`, `title`, `description`, `due_at`, `due_has_time`, `status`, `rationale`, `source`, `job_log_id`, `created_at`, `updated_at` | `status`는 `todo`\|`done` **두 값뿐**(결정 기록 1). `title` 외에는 전부 nullable(`AGT-1`). `job_log_id`는 `ON DELETE SET NULL` — 로그가 지워져도 태스크는 남는다. `due_has_time`은 날짜만 있는 마감을 가른다(§설계 결정 14) |
| `tags` | `id`, `user_id`, `name`, `created_at` | `(user_id, name)` 유니크. '미분류'는 가입 시 `on_auth_user_created` 트리거가 만든다(`AGT-5`, §설계 결정 11) |
| `task_tags` | `task_id`, `tag_id`, **`user_id`** | 다대다. 태그 병합(`DASH-6`)은 여기를 갈아끼운다. `user_id`를 든 이유는 §설계 결정 7 |
| `job_logs` | `id`, `user_id`, `source`, `outcome`, `failure_reason`, `capture_summary`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `created_at` | `AGT-8`이 요구하는 기록. 실패해도 `capture_summary`는 남긴다. `failure_reason`에는 [`04-API-Contract.md`](04-API-Contract.md)의 에러 코드를 그대로 넣는다 |

열거형 셋: `task_status`(`todo`\|`done`) · `source_kind`(`capture_create`\|`capture_complete`\|`mail`\|`manual`) · `job_outcome`(`created`\|`completed`\|`failed`). 이유는 §설계 결정 6.

- **RLS는 다섯 테이블 전부에 켠다.** 정책은 테이블당 하나, `to authenticated`, `using`·`with check` 모두 `(select auth.uid()) = user_id`(`profiles`만 `= id`). 명령별로 쪼개지 않는다 — 네 곳이 갈라지면 그 틈으로 남의 데이터가 보인다.
- 회원 탈퇴(`SET-1`)는 `auth.users` 한 행 삭제로 끝난다. `user_id`는 전부 `auth.users(id) ON DELETE CASCADE`를 타고, `task_tags`는 `tasks`·`tags`를 타고 따라 지워진다.
- `tasks.updated_at`은 되돌리기 가능 여부 판정(`HIST-4`: "사용자가 그 사이 직접 수정함")에 쓰인다. **DB 트리거**(`tasks_set_updated_at`)가 유지한다 — 애플리케이션에 맡기면 쓰기 경로가 늘 때마다 새는 구멍이 된다. 트리거가 **UPDATE에만** 걸려 생성 직후에는 `updated_at = created_at`이 성립하는 것이 그 판정의 근거다(`L-P1-02`). ⚠️ 행을 손으로 심을 때 `created_at`만 주면 `updated_at`은 `now()`가 되어 **"수정됨"으로 판정된다** — 테스트 시드가 실제로 여기 걸렸다.
- `tasks`가 `job_logs`를 가리키는 두 칸에 **각각 부분 인덱스**가 있다(`tasks_job_log_id_idx`·`tasks_completed_by_job_log_id_idx`). 앞의 것은 `L-P1-02`가 열었다 — 되돌리기 판정을 계산 컬럼으로 뽑으면서 목록 100건마다 점조회가 생겼다.
- 생성된 타입은 `lib/supabase/database.types.ts`. **손으로 수정하지 않는다.**

## 설계 결정

원본 기획에 없거나 암묵적이어서 여기서 새로 정한 것들이다. 제품 차원의 결정 8건은 [`00-Product.md`](00-Product.md) §5에 있다.

### 1. 캡처 원본 무저장 — 구현 방식

`AGT-10`을 지키기 위해 **Supabase Storage를 쓰지 않는다.** `API-3`이 multipart로 이미지를 받아 메모리에서 LLM 어댑터로 넘기고, 응답을 받는 즉시 버퍼를 놓는다. 디스크에 임시 파일을 만들지 않고, 요청 로그에 base64를 남기지 않는다.

남는 것은 `tasks.rationale` 한 문장과 `job_logs.capture_summary` 한 줄뿐이다.

> 이 결정은 [`00-Product.md`](00-Product.md) §7의 "향후 캡처 이미지를 직접 저장" 아이디어와 정면으로 충돌한다. 되살리려면 보존 기간·암호화·사용자 동의를 함께 설계해야 한다.

### 2. 10초 예산(`AGT-9`)과 동기 응답(`API-3`)

**P0은 단일 동기 요청으로 결과까지 반환한다.** `API-3`이 "앱은 이 응답만으로 알림을 만들 수 있어야 한다"고 못 박았기 때문에, 큐에 넣고 나중에 알리는 구조는 P0에서 쓸 수 없다.

- Vercel Route Handler의 `maxDuration`을 10초 예산에 맞춰 설정한다.
- 10초를 넘기면 실패로 처리하고 `job_logs`에 타임아웃으로 기록한다(`CAP-6`의 서버 측 짝).
- 비동기 처리와 이벤트 채널은 `API-7`(P2, 메일 소스)에서 도입한다. 메일은 앱 요청 없이 서버에서 생기므로 그때는 선택지가 없다.

### 3. Supabase 직접 접근 경계의 예외

경계 1("앱은 Supabase 직접 호출 금지")은 **Flutter 앱에 적용된다.** 브라우저 대시보드는 Dochi 자신이므로 `DASH-5`(새로고침 없는 실시간 반영)를 위해 **RLS 아래에서 Supabase Realtime을 직접 구독한다.**

이 예외가 안전한 이유: 브라우저에 실리는 것은 `sb_publishable_` 키뿐이고, 읽을 수 있는 범위는 RLS가 `auth.uid()`로 막는다. 쓰기는 여전히 Route Handler를 지난다.

**구현은 §21** — 구독이 나르는 것은 "바뀌었다"는 신호뿐이고 목록은 서버가 다시 그린다.

### 4. LLM 어댑터 — OpenAI, 단일 choke point

- 프로바이더는 **OpenAI (GPT)**로 확정(2026-09-20). 원본 기획의 "AWS Bedrock / GPT" 중 GPT를 택했다.
- `lib/llm/` 밖에서 `openai` SDK를 import 하면 **ESLint 에러**가 나게 만든다(`no-restricted-imports`, `openai/*` 포함). 규칙이 없으면 경계는 지켜지지 않는다. `e2e/llm-adapter.spec.ts`가 ESLint API로 이 규칙 자체를 검증한다.
- 어댑터는 프로바이더 중립 인터페이스를 노출한다(`lib/llm/types.ts` — OpenAI 고유 이름이 없다). 호출부는 `@/lib/llm`만 import 하고, 프로바이더를 바꿀 때는 `lib/llm/index.ts`의 `export` 한 줄과 구현 파일만 갈아 끼운다.
- 모든 호출은 `model` · `prompt_tokens` · `completion_tokens` · `latency_ms`를 `job_logs`에 남긴다.

**모델 — `gpt-5.6-luna` (L-P0-07, 2026-09-22 확인).** 출처: [models](https://developers.openai.com/api/docs/models) · [pricing](https://developers.openai.com/api/docs/pricing) · [images-vision](https://developers.openai.com/api/docs/guides/images-vision).

| 모델 | 입력 / 캐시 / 출력 (1M 토큰당) | 비고 |
|---|---|---|
| **`gpt-5.6-luna`** ✅ | $0.20 / $0.02 / $1.20 | 비용 최적 등급(이전 세대 nano 자리). 이미지 입력·Structured Outputs·Responses API 지원 |
| `gpt-5.6-terra` | $2 / $0.20 / $12 | 균형 등급. **L-P0-08 평가 세트에서 Luna의 품질이 모자라면 여기로 올린다** — `lib/llm/openai.ts`의 `MODEL` 한 줄 |

**호출당 비용 상한은 설정으로 강제한다.** 이미지는 `detail: "high"`로 보내 2048px·2,500패치(32px 패치 × 1.2 ≈ 3,000토큰)에서 잘리고, 출력은 `max_output_tokens: 2000`(추론 토큰 포함)에서 끊긴다. 프롬프트를 넉넉히 잡아 입력 ≤ 8k로 보면 **Luna 최악 ≈ $0.004/호출**이다. 실측(캡처 1장, 최소 스키마)은 입력 2,872 · 출력 43토큰 ≈ **$0.0006**, 지연 **3.6초**.

**L-P0-08 실측 (생성 프롬프트 + 스키마, Luna · effort low — 실험 8회 끝에 확정)** — 순차 실행 33호출 기준 입력 ≈ 5,100 · 출력 ≈ 330토큰, 지연 **중앙 4.3초 · p90 8.1초 · 최대 9.4초**, 호출당 ≈ $0.0014. effort medium은 품질이 오르지 않고 최대 지연만 18.5초(병렬)까지 늘었고, `gpt-5.6-terra`는 태그 해석이 흔들려 오히려 떨어졌다(실험표는 ROADMAP L-P0-08). **p90이 이미 8초라 10초 예산의 여유가 거의 없다** — 마무리 확인 실행에서는 순차로도 최대 18.3초가 한 번 나왔다. L-P0-10에서 타임아웃 경로가 실제로 자주 탈 수 있다.

> ⏱ **지연 3.6초는 10초 예산(`AGT-9`)의 36%다.** 에이전트 프롬프트와 스키마가 붙는 L-P0-08에서 다시 재고, 넘치면 `effort`를 `none`으로 내리거나 `detail`을 낮추는 것부터 본다 — 모델을 올리는 쪽은 지연도 같이 오른다.

**게이트웨이 경로 — `bedrock-gpt-5.6-sol` (HF-09, 2026-09-28).** 경진대회 본부가 준 OpenAI 호환 게이트웨이(AWS Bedrock 뒤)다. `LLM_GATEWAY_API_KEY`가 있으면 같은 SDK에 `baseURL`만 바꿔 그쪽으로 보내고, **env를 빼면 위 OpenAI·Luna 경로로 돌아간다**(롤백 = env 삭제). 키가 승인받은 별칭은 Sol·Claude Sonnet 5 둘뿐이고, Claude는 Responses API의 `json_schema`를 무시해 쓰지 않는다. 아래 설정 넷은 게이트웨이에서도 그대로 먹는다(`store: false`의 의미는 게이트웨이 운영 쪽 로그와 별개다 — HF-09 문의 항목). 평가 결과·지연은 ROADMAP HF-09.

**설정 넷 — 바꾸기 전에 읽을 것** (`lib/llm/openai.ts`)

| 설정 | 기본값 | 우리 값 | 이유 |
|---|---|---|---|
| `store` | `true` | **`false`** | 기본값은 응답을 OpenAI 쪽에 **30일 보관**한다. 캡처 무저장(`AGT-10`)은 우리 저장소만의 이야기가 아니다. 대화를 이어 가지 않으니([`07-Prompt-Principles.md`](07-Prompt-Principles.md) §B) 잃는 것도 없다 |
| `maxRetries` (SDK) | 2 | **0** | 재시도가 붙으면 느린 호출 한 번이 10초 예산을 통째로 먹는다. 시간 제한은 호출부가 넘기는 `AbortSignal` 하나로만 건다 |
| `reasoning.effort` | `medium` | **`low`** | 캡처 한 장 읽기에 깊은 추론은 지연만 늘린다. 충분한지는 L-P0-08 평가 세트가 판정한다 |
| `text.format` | 자유 텍스트 | **`json_schema` + `strict: true`** | 출력이 그대로 DB에 들어간다([`07-Prompt-Principles.md`](07-Prompt-Principles.md) §B). zod를 들이지 않고 JSON Schema 객체를 그대로 넘긴다 |

**계측은 어댑터가 쓰지 않고 돌려준다.** `analyzeImage()`는 `{ output, usage }`를 반환하고, 실패하면 `LlmError`가 `usage`를 들고 나온다(응답을 못 받았으면 토큰은 null, 모델·지연은 채움). 기록은 `lib/api/job-logs.ts`의 `recordJobLog()`가 **한 행을 한 번에** 쓴다. 어댑터가 직접 쓰지 않는 이유: `job_logs` 행의 `outcome`·`capture_summary`는 응답을 해석한 뒤에야 정해지는데 `outcome`이 NOT NULL이라, 어댑터가 먼저 쓰면 임시값을 넣었다가 고치는 두 번의 쓰기가 된다. 대신 `recordJobLog`의 `usage`를 **필수 인자**로 두어 계측을 빠뜨린 호출이 컴파일되지 않게 했다.

### 5. API 응답 봉투

성공과 실패를 **한 가지 모양**으로만 표현한다. 앱이 분기를 하나만 쓰면 되게 하기 위해서다.

```
성공  { "data": ... }
실패  { "error": { "code": "...", "message": "..." } }
```

`code`는 기계가 읽고(앱이 분기), `message`는 사람이 읽는다(알림 본문). HTTP 상태 코드와 `code`는 둘 다 채운다.

### 6. 상태·소스·결말은 `text + CHECK`가 아니라 Postgres 열거형

`supabase gen types`가 열거형을 **리터럴 유니온**(`"todo" | "done"`)으로 뽑아내기 때문이다. `text + CHECK`로 두면 생성된 타입이 그냥 `string`이 되고, "상태는 둘뿐"(결정 기록 1)이라는 제품 규칙이 컴파일 타임에서 사라진다. 규칙을 DB에만 적어 두면 코드는 그 규칙을 모른다.

값을 늘리려면 마이그레이션이 필요하다는 점은 **비용이 아니라 목적이다** — `status`에 값을 하나 더 붙이는 일이 손쉬워서는 안 된다.

### 7. `task_tags`가 `user_id`를 들고 있다

조인 테이블에 소유자를 비정규화해 넣었다. 이유 둘:

1. **RLS 정책이 다른 네 테이블과 같은 한 줄이 된다.** 정책에 조인 서브쿼리를 넣으면 행마다 `tasks`를 다시 읽는다.
2. **복합 FK가 소유권 어긋남을 스키마에서 막는다.** `task_tags (task_id, user_id) → tasks (id, user_id)`, `(tag_id, user_id) → tags (id, user_id)` 두 FK 때문에 "남의 태스크에 내 태그 달기"는 삽입 단계에서 거부된다. 이를 위해 `tasks`·`tags`에 `unique (id, user_id)`를 뒀다.

비정규화의 통상적 대가인 값 어긋남은 2번이 막으므로 실제로 치르지 않는다.

### 8. 앱 인증 경계는 `sb_secret_`이 서버를 벗어나지 않는 것으로 지킨다

브라우저에 실리는 것은 `sb_publishable_` 키뿐이고, 이 키로 읽을 수 있는 범위는 RLS가 `auth.uid()`로 자른다(§설계 결정 3). `sb_secret_` 키는 RLS를 통째로 우회한다.

🔑 **경계는 파일 종류의 목록이 아니라 번들 경계다 — `sb_secret_`은 브라우저 번들에 닿지 않는 코드에서만 쓴다.** 지금 그것을 쓰는 곳은 Route Handler(P0) · 서버 컴포넌트(앱 로그인 진입점 — 결정 18) · **Server Action(회원 탈퇴 — `L-P1-07`)** · 테스트 하네스 넷이고, 넷 다 `"use client"` 모듈과 그것이 import 하는 것에서 보이지 않는다. 목록으로 적으면 새 종류가 나올 때마다 문서가 현실에 진다(실제로 결정 18에서 한 번 졌다 — `lib/supabase/admin.ts`의 주석이 "Route Handler에서만"이라고 적힌 채 유일한 사용처가 서버 컴포넌트였다).

**쓰는 범위의 선은 "요청자 자신의 것만"이다.** 결정 18은 "데이터 접근에는 쓰지 않는다"고 적었는데 탈퇴는 `auth.admin.deleteUser`라 그 선을 넘는다 — 그래서 선을 옮긴다. 지우는 대상이 `requireUser()`가 돌려준 `user.id` 하나뿐이라 남의 id가 들어갈 자리가 없고, 이 키로 목록을 읽거나 남의 행을 건드리는 코드는 여전히 없다. 데이터를 읽고 쓰는 것은 언제나 요청자 토큰을 단 클라이언트(RLS)의 몫이다.

⚠️ **기계적 가드가 없다.** ESLint `no-restricted-imports`는 `openai`만 막는다(LLM choke point와 달리 여기는 강제되지 않는다). 이 경계는 리뷰와 이 문단이 지킨다 — 대신 `lib/supabase/admin.ts`를 import 하는 자리는 `grep`으로 셀 수 있을 만큼 적어야 하고, 지금은 셋이다.

L-P0-02의 검증 테스트가 publishable과 secret 두 역할을 실제로 갈라 놓고 확인한다(`e2e/rls.spec.ts`).

### 9. 인증은 `proxy.ts`가 아니라 핸들러 래퍼(`withAuth`)다

루프 이름이 "인증 미들웨어"였지만 파일 컨벤션 미들웨어를 쓰지 않았다. **되돌리기 전에 읽을 것** — 세 가지 이유가 있다.

1. **Next 16에서 `middleware.ts`는 deprecated고 `proxy.ts`로 개명됐다.** 그리고 proxy 문서가 "최적화된 경우 CDN에 배포되니 공유 모듈이나 전역에 기대지 말라"고 못 박는다. 인증 검증은 데이터에 손대기 직전에 있어야 하는 것이지 요청 경계에서 한 번 훑고 끝낼 일이 아니다.
2. **proxy는 요청 객체에 값을 실어 보낼 수 없다.** userId를 넘기려면 헤더에 써야 하고, 그러면 핸들러는 검증되지 않은 문자열을 믿게 된다. 사용자 스코프 Supabase 클라이언트는 어차피 핸들러가 다시 만들어야 한다.
3. **`withAuth`는 검증과 동시에 요청자의 토큰을 단 클라이언트를 건넨다.** 덕분에 "남의 자원은 404"가 핸들러의 분기가 아니라 **RLS의 성질**로 성립한다. 핸들러에 소유권을 비교하는 코드가 없고, 없으니 빠뜨릴 수도 없다.

**토큰 검증은 `getUser()`로 한다** (2026-09-27 HF-05에서 `getClaims()`에서 바꿨다). `getUser()`는 요청마다 Auth 서버에 묻고, Auth는 서명뿐 아니라 **사용자와 세션이 아직 있는지**까지 본다. 그래서 탈퇴·세션 폐기·(향후) 정지가 즉시 `401`이 된다.

- **왜 바꿨나** — 처음에는 `getClaims()`(ES256 + JWKS 캐시, 로컬 WebCrypto 검증)로 Auth 왕복을 없애고 "폐기된 세션이 잔여 수명(1시간)까지 통과한다"는 대가를 계약에 적어 두었다. 그런데 앱은 `401`에만 반응하도록 만들어져 있어서, 탈퇴한 계정의 토큰을 쥔 앱이 캡처는 실패하는데 로그인 화면으로 돌아오지도 않는 상태에 갇혔다 — 다른 계정으로 웹에 로그인해도 바뀌는 것은 웹 세션뿐이라 그대로였다(앱 부서 보고). 이론상 액세스 토큰이 만료되면(최대 1시간) 갱신이 실패하며 풀리지만, 사용자는 그걸 알 길이 없다. "빈 목록을 탈퇴로 단정하지 말라"는 계약 문장이 앱에게 빠져나갈 신호를 하나도 주지 않은 것이 뿌리다.
- **대가** — 요청마다 Auth 왕복 한 번. 배포본(`icn1` ↔ `ap-northeast-2`)에서 `GET /api/v1/me` 왕복이 교체 전 p50 35ms · p90 98ms, 교체 후 p50 48~64ms · p90 112~284ms(세 번 재어 범위로 — 클라이언트에서 20회씩 실측). p50 기준 +15~30ms. 캡처의 10초 예산(`AGT-9`)에서 무시할 크기다.
- **Auth 장애는 `401`이 아니다.** 4xx만 `401`로, 5xx·네트워크 실패는 `500 INTERNAL_ERROR`로 가른다 — `/auth/app/token`의 `respond()`와 같은 원칙이다. 합치면 Auth가 잠깐 흔들릴 때 앱이 멀쩡한 사용자를 전부 로그아웃시킨다.
- **웹 화면(`currentUser()`)은 여전히 `getClaims()`다.** 탈퇴한 브라우저는 `deleteAccount`가 곧바로 `signOut()`하고, 다른 브라우저에 남은 쿠키는 잔여 수명 뒤 갱신이 실패하며 `/login`으로 간다. 페이지 렌더마다 왕복을 더할 이유가 아직 없다.

### 10. 웹 세션은 `proxy.ts`가 갱신하고, 판단은 `requireUser()`가 한다

**되돌리기 전에 읽을 것.** 결정 9가 "인증은 proxy가 아니다"라고 했는데 `proxy.ts`가 생겼으므로, 다음 세션이 "결정 9에 따라 지우자"고 할 자리다. 둘은 층이 다르다.

- **판단은 `lib/supabase/session.ts`의 `requireUser()` 한 곳에만 있다.** 화면도 Server Action도 여기를 지난다. `proxy.ts`는 누구인지 판정하지 않고 낙관적 리다이렉트도 하지 않는다 — 판단하는 자리가 둘이 되면 언젠가 갈라지고, 갈라지면 그 틈이 곧 구멍이다.
- **proxy가 하는 일은 쿠키 갱신뿐이다**(`getClaims()` 한 줄). 그 자리가 필요한 이유는 프레임워크 제약이다: Server Component는 쿠키를 쓸 수 없고(Next 16 `cookies` 문서 — 스트리밍이 시작된 뒤에는 `Set-Cookie`를 붙일 수 없다), `@supabase/ssr`은 "쿠키를 쓸 수 없는 환경이면 미들웨어가 반드시 세션 갱신을 맡아야 한다"고 못 박는다. 이 프로젝트는 리프레시 토큰 회전이 켜져 있어(`config.toml`의 `enable_refresh_token_rotation`, 재사용 허용 10초) 갱신된 토큰을 저장하지 못하면 **잠시 뒤 무작위 로그아웃**이 난다.

결정 9의 세 근거를 그대로 대조하면 모순이 없다.

| 결정 9의 근거 | 이 proxy에 적용되는가 |
|---|---|
| CDN에 배포될 수 있으니 공유 모듈·전역에 기대지 말라 | 기대지 않는다. 요청마다 클라이언트를 새로 만들고 가변 전역을 읽지도 쓰지도 않는다. 게다가 **Next 16에서 proxy의 기본 런타임은 Node.js**라 Edge 시절 제약이 사라졌다 |
| 요청 객체에 값을 실을 수 없다 | 참이다. **그래서 싣지 않는다** — 신원을 아래로 넘기지 않는다 |
| `withAuth`가 RLS 스코프 클라이언트를 함께 건넨다 | 참이다. 웹 쪽 짝이 `requireUser()`이고, 화면의 모든 DB 접근도 자기 쿠키로 만든 RLS 스코프 클라이언트를 지난다 |

`matcher`에서 `/api`를 제외한다 — 앱 경로는 Bearer·무상태라 쿠키 클라이언트가 순수 낭비다.

> ⚠️ `@supabase/ssr` 0.12.7의 `setAll`은 **2인자**(`cookiesToSet, headers`)다. 두 번째 인자의 `Cache-Control: private, no-store…`를 응답에 반영하지 않으면 CDN이 한 사용자의 세션 쿠키를 다른 사용자에게 서빙할 수 있다.

### 11. 가입 부트스트랩은 애플리케이션이 아니라 DB 트리거다

계정이 생기는 순간 `profiles` 행과 '미분류' 태그가 함께 생겨야 한다(`AGT-5`의 전제). 이것을 `on auth.users` 트리거(`on_auth_user_created`)로 두는 이유는 **가입 경로 넷 중 둘이 우리 코드를 지나지 않기 때문이다.**

| 경로 | 우리 코드를 지나나 |
|---|---|
| 웹 이메일 가입 | ✅ `app/(auth)/actions.ts` |
| Google 최초 로그인 | ❌ Supabase가 직접 만든다 |
| `admin.createUser()` (테스트 하네스) | ❌ |
| 앱 경유 가입 (`L-P0-04`) | ❌ 아직 없다 |

한 경로라도 빠지면 태그 없는 계정이 생기고, 그 계정에서 `AGT-5`("애매하면 '미분류'")가 무너진다. 트리거는 `auth.users` 삽입과 같은 트랜잭션에서 돌아 넷을 한 번에 덮는다.

- `set_updated_at()`과 달리 **`security definer`다.** 이 트리거는 auth 서버 역할로 실행되는데 그 역할에는 `public` 테이블 권한이 없고 RLS도 걸려 있다.
- **`on conflict` 방어절을 두지 않았다.** `after insert on auth.users`는 사용자당 정확히 한 번 돌고, 이미 가입한 주소로 Google 로그인을 해도 Supabase는 identity를 기존 행에 연결할 뿐 새 행을 만들지 않는다. 충돌 경로가 없는 곳에 방어 코드를 두지 않는다.
- 대가는 알고 받는다 — **이 함수가 에러를 내면 가입 트랜잭션 전체가 롤백된다.** 그래서 함수를 두 줄로 유지한다.

### 12. 메일 확인을 켜 두고 커스텀 SMTP(Resend)를 붙인다

Supabase 기본 SMTP는 **시간당 2통**이라 확인 메일을 쓰는 순간 실사용과 테스트가 모두 막힌다. 확인을 끄면 그 문제는 사라지지만 남의 주소로 가입할 수 있게 되어, 실제 소유자가 나중에 가입하지 못한다. 그래서 **확인은 켜 두고 발송 경로를 바꿨다.**

- SMTP는 Resend(`smtp.resend.com:465`, 사용자 `resend`, 비밀번호는 API 키). 키는 **Supabase 대시보드에만** 들어가므로 저장소 환경변수가 늘지 않는다.
- 커스텀 SMTP를 붙인 뒤 대시보드의 발송량 제한(`Rate limit for sending emails`)도 함께 올린다. 이걸 빠뜨리면 SMTP를 붙여도 Supabase 단에서 막혀 증상이 똑같다.
- **메일 템플릿은 `{{ .ConfirmationURL }}` 대신 `token_hash` 형식 링크를 쓴다**(`/auth/callback?token_hash={{ .TokenHash }}&type=…&next=…`). 기본 링크는 링크를 연 브라우저에 검증용 쿠키가 있어야 해서, 컴퓨터에서 가입하고 폰에서 메일을 열면 깨진다.
- 템플릿의 원본은 대시보드다. 저장소의 [`supabase/templates/`](../supabase/templates/README.md)는 손으로 맞추는 **사본**이고, 푸시하지 않는다(`L-P1-13`).
- 덤 — `admin.generateLink()`가 돌려주는 값이 바로 이 해시라, **메일을 한 통도 보내지 않고** 확인·재설정 전 구간을 Playwright로 검증할 수 있다(`e2e/auth.spec.ts`).

가입 동선에 단계가 하나 는다: `/signup` 제출 → 안내 화면 → 메일 링크 → `/auth/callback` → `/dashboard`. `AUTH-1`("**인증 후** 대시보드로 이동")은 메일 확인을 인증의 일부로 보아 그대로 성립한다.

> 🔁 **2026-09-25 — 메일 확인을 껐다**(사용자, Supabase 대시보드). QA에서 가입 메일이 안 오고(이미 Google로 가입된 주소라 Supabase가 가짜 성공만 주고 보내지 않은 경우였다) 재시도가 발송 제한에 걸리면서 가입 자체가 막혔다. 위에서 받아들이지 않았던 대가 — **남의 주소로 가입할 수 있다** — 를 이제는 알고 받는다. 지금 동선은 `/signup` 제출 → 곧바로 `/dashboard`(`signUp`이 세션을 돌려주는 갈래, `app/(auth)/actions.ts`). 이미 가입된 주소면 `user_already_exists`로 "이미 가입된 이메일입니다"가 뜬다. SMTP·`token_hash` 템플릿은 비밀번호 재설정이 여전히 쓰므로 그대로 둔다. 다시 켜면 안내 화면 경로가 코드에 살아 있다.

### 13. 태스크와 태그 연결은 DB 함수 안에서 한 번에 쓴다

`supabase-js`에는 트랜잭션이 없다. "태스크 insert → `task_tags` insert"를 두 요청으로 보내면 둘째가 실패했을 때 **태그 없는 태스크가 남는다.** 그래서 `create_task`·`set_task_tags` 두 함수(`supabase/migrations/…_task_write_functions.sql`)가 한 트랜잭션으로 쓴다.

- **`security invoker`(기본값)다** — 결정 11의 트리거와 반대다. 요청자 권한으로 돌아 RLS와 결정 7의 복합 FK가 그대로 걸린다. 남의 태그 id는 `(tag_id, 내 uid)` 쌍이 없어 `23503`으로 거부되고, 핸들러는 이것을 `400 VALIDATION_FAILED`로 바꾼다. **소유권 비교 코드는 여전히 없다**(결정 9).
- `create_task`는 `source`·`rationale`·`job_log_id`도 받는다. HTTP `POST`는 늘 `manual`로 부르지만 **에이전트(`L-P0-08`)가 같은 함수로 태스크를 만들게** 하려고 열어 두었다.
- **PATCH는 두 단계다** — 필드는 단일 행 `update`(그 자체로 원자적)로, 태그는 `set_task_tags`(지우기와 넣기를 한 트랜잭션으로)로 쓴다. 둘 사이에서 끊기면 필드만 바뀐 채 `500`이 나간다. 이것을 받아들인 이유: 태그가 **비는** 중간 상태는 없고, 같은 PATCH를 다시 보내면 수렴한다. PATCH 전체를 함수로 옮기면 "보낸 키만 바꾼다"를 plpgsql의 jsonb 분기로 다시 써야 한다.

**'미분류' 보호는 트리거가 아니라 핸들러에 있다**(`app/api/v1/tags/[id]/route.ts`). `before delete` 트리거로 막으면 계정 삭제의 CASCADE(`SET-1`)까지 막힌다. 핸들러는 `.neq('name', '미분류')`를 쓰기 조건에 실어, 읽고 판단하는 사이의 틈 없이 막는다. 0행이 나오면 한 번 더 읽어 "보호돼서"(`409 TAG_PROTECTED`)와 "없거나 남의 것"(`404`)을 가른다 — **남의 '미분류'에 `TAG_PROTECTED`를 내면 그 id가 실재한다는 것을 흘리므로** 이 순서가 중요하다.

**병합(`merge_tags`)에서는 같은 보호가 SQL 쪽에 한 벌 더 있다**(`…_merge_tags.sql`, `L-P1-05`, 사용자 결정 2026-09-24). 병합은 rpc **한 번**이라 `.neq()`를 실을 자리가 없고, 라우트에서 먼저 읽어 막으면 위 문단이 없앤 그 틈이 되살아난다. 그래서 `'미분류'` 리터럴이 삭제 문장의 WHERE에 들어가 있다. **인자(`p_protected_name`)로 받지 않는다** — 받으면 `authenticated` 누구나 rpc를 직접 불러 보호를 끌 수 있고, 판정 기준을 호출자가 정하게 되어 "판정은 DB 한 곳"이 이 함수에서만 뒤집힌다. 트리거를 피한 이유(계정 삭제의 CASCADE)는 **함수 WHERE에는 해당하지 않는다** — CASCADE는 이 함수를 지나지 않는다. 대가는 문자열이 세 곳(`lib/api/tags.ts`의 `UNCATEGORIZED`·가입 트리거·이 함수)에 있는 것이고, 갈라지면 `e2e/tags.spec.ts`의 "'미분류' 출발 → 409"가 즉시 빨간불이 된다.

**보호는 출발에만 건다.** 출발 태그는 병합으로 **사라지므로** `AGT-5`의 전제가 무너지지만, 도착이 '미분류'인 병합은 태그를 하나도 없애지 않아 막을 이유가 없다 — 오히려 "잘못 만든 태그를 미분류로 되돌린다"는 정상 동선이다. 대칭이 아닌 것이 의도다. 남의 '미분류'가 `404`로 합류하는 것은 여기서도 그대로인데, 이번에는 코드가 아니라 **RLS가 자동으로** 만든다(`security invoker` 함수 안에서 남의 태그는 0행이다).

### 14. 날짜만 있는 마감 — 그날 23:59:59 + `due_has_time = false`

'9/21까지'처럼 날짜만 드러난 마감과 '내일 8:30'처럼 시각까지 드러난 마감은 `due_at`(timestamptz) 하나로 구분되지 않는다. L-P0-08에서 에이전트가 이 둘을 쓰기 시작하면서 정했다(사용자 결정, 2026-09-22).

- **컬럼을 하나 더 둔다** — `tasks.due_has_time boolean not null default false`, CHECK로 "마감 없음 + 시각 있음"을 막는다(`…_task_due_has_time.sql`). 23:59:59라는 값 자체를 "시각 없음"의 표지로 쓰는 방법도 있었지만, 사용자가 정말 23:59로 잡은 마감과 섞인다.
- **`due_at`에는 사용자 시간대 기준 그날의 끝(23:59:59)을 넣는다.** 자정(00:00)이 아닌 이유: 마감은 "언제까지"이고, 자정으로 두면 당일 00:01부터 '마감 지남'으로 판정되어 `DASH-1` 강조가 틀어진다. 이렇게 두면 정렬과 판정은 `due_at` 하나로 그대로 맞고, `due_has_time`은 **표시에만** 쓰인다.
- **시간대 변환은 모델이 아니라 서버가 한다.** 에이전트는 `dueDate`(`YYYY-MM-DD`)와 `dueTime`(`HH:MM` | null)을 따로 내고, `lib/time.ts`의 `toDueAt()`이 요청의 `timezone`으로 UTC 순간을 만든다(`Intl`만 쓰고 서머타임도 맞춘다). 오프셋 계산은 틀려도 티가 안 나는 종류의 실수라 결정적인 코드에 둔다.
- API에서는 `dueHasTime`이 **`dueAt`과 한 몸**이다 — `dueAt`과 함께만 받고, 생략하면 `true`(완전한 타임스탬프를 보냈으므로). 따로 받으면 CHECK에 걸려 500이 된다. 계약은 [`04-API-Contract.md`](04-API-Contract.md) §태스크.

### 15. 생성 에이전트 — 로그 먼저, 화자를 칸으로

`lib/agent/create.ts`의 `runCreateAgent()`. 프롬프트·스키마는 `lib/agent/create-prompt.ts`(원칙은 [`07-Prompt-Principles.md`](07-Prompt-Principles.md)).

- **순서: 태그 목록 읽기 → LLM 한 번 → `recordJobLog()` → 태스크마다 `create_task`.** 로그가 태스크보다 먼저인 것은 태스크가 `job_log_id`로 로그를 가리키기 때문이다. 태스크 여러 개는 한 트랜잭션이 아니다 — 도중에 실패하면 앞의 것이 남고 예외가 올라간다. 드문 경우이고, 전체를 DB 함수로 옮기면 태그 생성까지 plpgsql로 다시 써야 해서 받아들였다.
- **경계** — 10초 예산(`AbortSignal`)과 LLM 실패의 작업 로그는 호출부(L-P0-10 캡처 API)가 맡는다. 에이전트는 `LlmError`를 그대로 올려 보낸다. 반환 모양은 계약 §캡처의 `data`와 같아서 캡처 API는 감싸기만 한다.
- **`quotes`는 `{ speaker: user|other|document, text }`다.** 메신저에서 사용자와 상대를 뒤바꿔 "상대가 하겠다고 한 일"을 사용자 태스크로 만드는 것이 가장 흔한 오판이었고, 지시문만으로는 고쳐지지 않았다(평가 2차 9/11). 인용마다 화자를 먼저 적게 강제하자 그 오판이 사라졌다(3차). 신뢰도 칸이 아니라 **판단 근거** 칸이라 결정 기록 2와 부딪히지 않는다.
- **프롬프트에 평가 세트의 정답을 싣지 않는다.** 1~3차 프롬프트는 예시에 평가 캡처의 조각('Excel, PPT', '학생 수강 문의', 'JAN 26' 등)을 담고 있었다. 점수는 오르지만 일반성은 사라진다. `e2e/agent-create.spec.ts`의 누수 가드가 평가·보류 세트의 조각·태그가 프롬프트에 없는지 매번 확인하고, 예시는 다른 도메인(영업·동호회·치과)으로 쓴다. 일반성은 튜닝에 쓰지 않는 **보류 세트**(`e2e/fixtures/captures/holdout/`)로 따로 확인한다
- **새 태그는 에이전트가 만들 수 있다**(`AGT-5` "확실히 새로운 일일 때만"). 모델이 기존에 없는 이름을 내면 `tags`에 insert한다. 아무 태그도 없으면 '미분류'.

### 16. 완료 에이전트 — 후보를 요청마다 enum으로, 로그는 반영 뒤

`lib/agent/complete.ts`의 `runCompleteAgent()`. 프롬프트·스키마는 `lib/agent/complete-prompt.ts`.

- **순서: 미완료 태스크 읽기 → LLM 한 번 → `status='todo'` 조건을 건 update → `recordJobLog()`.** 생성과 달리 이 로그를 가리키는 행이 없으므로 반영한 **뒤에** 써서 로그가 실제 결과를 적게 한다. 목록을 읽은 뒤 사용자가 먼저 닫았다면 update가 0행이고 `NO_TASK_TO_COMPLETE`로 합류한다.
- **후보는 번호(`"1"`, `"2"`…)로 보여 주고, 스키마의 `taskKey`를 그 번호의 enum + null로 요청마다 만든다.** 모델이 목록에 없는 태스크를 고를 수 없게 되고(구조화 출력이 막는다), UUID보다 토큰이 적다. 번호 → id는 서버가 쥔다. 후보가 0개면 `taskKey`는 `{type:"null"}` — 빈 enum은 스키마로 성립하지 않는다.
- **후보가 0개여도 LLM을 부른다.** 실패에도 `capture_summary`를 남겨야 해서다(`AGT-8`). 호출 하나를 아끼려고 요약 없는 실패 로그를 두지 않는다.
- **`rationale`을 `job_logs.rationale`에 저장한다**(L-P1-01). P0에서는 판단 전에 이유를 적게 하는 추론 칸으로만 쓰고 버렸는데, 완료 오판의 교정이 히스토리의 존재 이유라 칸을 열었다. **실패에도 싣는다** — 프롬프트가 "왜 끝났는지, 또는 **왜 닫을 것이 없는지**"를 요구하므로 값이 있고, `HIST-2`의 [직접 처리]가 읽는다. 생성 경로는 비워 둔다(근거가 태스크마다 달라 이미 `tasks.rationale`에 있다).
- **닫은 태스크는 `tasks.completed_by_job_log_id`가 가리킨다**(L-P1-01). 방향이 `job_logs` 쪽이 아닌 이유는 되돌리기의 재실행 안전성 때문이다 — 로그 A가 X를 닫고 → 되돌리고 → 로그 B가 X를 다시 닫았을 때, `job_logs` 쪽에 두면 A의 되돌리기가 B의 결과를 지운다. `tasks` 쪽이면 B가 칸을 덮었으므로 A가 0행을 만나 자연히 거부된다. 대가는 그 시나리오에서 A의 '관련 태스크' 표시가 비는 것인데, 데이터 손상보다 표시 공백을 택했다.
- **연결 칸은 로그를 쓴 *뒤에* 따로 채운다** — update 한 번이 아니라 두 번이다. FK라 로그 행이 먼저 있어야 하는데, `outcome`은 update가 0행인지 봐야 정해지기 때문이다. 로그를 낙관적으로 먼저 쓰는 대안은 **가장 흔한 실패 경로**(`NO_TASK_TO_COMPLETE`)에 "완료했다고 적힌 로그 → 정정" 구간을 만든다 — 정정이 실패하면 거짓이 영구화된다. 두 번째 update가 실패하면 `create_task` 실패와 같이 던져 `500`이 되고, 남는 것은 *덜 적힌 로그*다(연결이 비면 되돌리기가 거부될 뿐 데이터는 멀쩡하다). 성공 경로에만 왕복 하나가 는다.
- 경계·누수 규칙은 결정 15와 같다. 누수 가드는 `e2e/agent-complete.spec.ts`가 평가 세트의 `seedTasks` 제목·태그로 확인한다.

### 17. 캡처 API — 10초 신호는 LLM에만, 실패 로그는 라우트가

`app/api/v1/captures/route.ts`는 신호를 만들고 `lib/api/captures.ts`의 `parseCaptureForm()` → `runCapture()`를 잇기만 한다. 본체를 라우트 밖에 둔 것은 테스트가 HTTP 없이 1ms 신호로 타임아웃 경로를 결정적으로 밟기 위해서다.

- **`AbortSignal.timeout(10_000)`을 요청이 들어온 순간 만들고, 그 신호는 LLM 호출에만 닿는다.** 요청 전체를 `Promise.race`로 자르면 응답은 504인데 뒤에서 DB 쓰기가 계속 돌아 태스크가 생길 수 있다. LLM이 끝나기 전에는 아무것도 반영되지 않으므로 거기서 끊으면 **"504면 반영된 것이 없다"**가 성립하고, 앱은 504를 그대로 실패 알림으로 띄우면 된다. 대가: LLM이 9.9초에 끝나면 DB 몇 왕복(실측 ≈ 0.6초)만큼 10초를 넘긴다 — 그때도 결과는 정상 200이다.
- **실패 로그** — `LlmError.aborted`면 `504 AGENT_TIMEOUT`, 그 밖의 `LlmError`면 `500 INTERNAL_ERROR`. 둘 다 라우트가 `failed` 로그를 `LlmError.usage`와 함께 쓴다. LLM 뒤의 DB 오류는 `500`만 내고 로그를 더 쓰지 않는다(DB가 응답하지 않는 상황이고, 생성 경로는 이미 로그가 있다).
- **타임아웃·LLM 오류의 로그에는 `capture_summary`가 없다.** 요약은 LLM 출력에서만 나오고, 요약을 위해 한 번 더 부르면 예산을 깬다. `AGT-8`의 "실패해도 요약"은 에이전트가 판단한 실패(`NO_TASK_TO_*`)에서 성립한다.
- **이미지 4MB 상한** — Vercel 함수의 요청 본문 한도(4.5MB)에 걸리면 플랫폼이 봉투 밖의 413을 낸다. 그 전에 우리가 `400`으로 막는다. 모델이 `detail: high`에서 긴 변을 2048px로 줄이므로 앱이 줄여 보내도 잃는 것이 없다.
- **MIME은 part의 Content-Type을 그대로 믿는다**(`image/png|jpeg|webp`). 바이트를 들여다보지 않는다 — 틀린 타입이면 OpenAI가 거절해 500이 될 뿐 안전 문제는 아니다.
- **`AGT-10`** — 바이트는 `File.arrayBuffer()`에서 에이전트로만 건너간다. 로그(`console.error`)에는 에러의 `code`·`message`만 찍고 원인 객체를 통째로 싣지 않는다.

### 18. 앱 로그인 — 브라우저 세션을 넘기지 않고, 앱 전용 세션을 일회용 코드로 연다

`AUTH-3`의 웹 측. 흐름과 요청·응답 모양은 [`04-API-Contract.md`](04-API-Contract.md) §앱 로그인. 파일은 `app/auth/app/start/page.tsx`(진입점) · `app/auth/app/token/route.ts`(교환·갱신) · `lib/auth/app-bridge.ts`.

- **브라우저 세션의 토큰을 앱에 복사하지 않는다.** 리프레시 토큰 회전이 켜져 있어(결정 10) 한 세션을 둘이 나눠 쓰면, 한쪽이 갱신한 뒤 다른 쪽이 옛 리프레시 토큰을 내미는 순간 재사용 감지로 **세션이 통째로 폐기된다** — 앱과 웹이 번갈아 무작위로 로그아웃된다. 그래서 앱에는 새 세션을 연다.
- **새 세션을 여는 열쇠는 magiclink의 `hashed_token`이다.** 관리자 API(`generateLink`)가 **메일을 보내지 않고** 만들어 주고, 일회용이며 `otp_expiry`(1시간)에 만료되고, `verifyOtp`로 풀면 이메일·Google 어느 쪽으로 가입했든 같은 사용자의 새 세션이 선다. 별도 코드 테이블이 필요 없다. 대가: 사용자당 유효한 magiclink가 하나라 **새로 발급하면 이전 코드는 무효**가 된다(앱 둘이 동시에 로그인하면 늦게 받은 쪽만 산다).
- **딥링크에는 코드만 싣는다.** URL은 기록에 남고 커스텀 스킴은 다른 앱이 가로챌 수 있다. 오래 사는 리프레시 토큰은 앱이 `POST /auth/app/token`의 HTTPS 본문으로만 받는다.
- **진입점은 Route Handler가 아니라 페이지다.** 로그인 Server Action이 `redirect()`하면 Next는 같은 호스트의 대상을 서버 안에서 미리 fetch해 인라인하려 한다(`action-handler.js`의 `createRedirectRenderResult`). Route Handler가 `dochi://`로 307하면 그 fetch가 "HTTP(S)가 아님"으로 실패하고, 라우터 재시도·하드 내비게이션을 거치며 **로그인 한 번에 코드가 세 번 발급됐다**(실측). 페이지의 `redirect()`는 문서 요청이면 307, Server Action 뒤면 RSC 안의 리다이렉트 지시가 되어 한 번에 끝난다. 그래서 허용되지 않은 주소도 JSON 400이 아니라 오류 화면이다.
- **교환·갱신 엔드포인트는 `/api/v1` 밖(`/auth/app/token`)에 둔다.** `/api/v1`의 "모든 엔드포인트가 Bearer, 예외 없음"(🔒)을 지키기 위해서다 — 이 경로는 정의상 토큰이 없거나 만료된 앱이 부른다. 봉투는 같은 것을 쓴다. 갱신을 여기 둔 것은 앱이 Supabase를 직접 부르지 않기 때문이다(`API-1`).
- **`sb_secret_`을 쓰는 곳이 서버 컴포넌트 하나 늘었다**(`lib/supabase/admin.ts` → 진입점 페이지). 결정 8의 경계는 "서버를 벗어나지 않는다"이고 서버 컴포넌트는 브라우저로 번들되지 않는다. 쓰는 일은 코드 발급 하나뿐이고 데이터 접근에는 쓰지 않는다.
- **웹 로그아웃은 `scope: "local"`이다.** 기본값 `global`은 계정의 모든 세션을 폐기해 앱까지 끊는다. 앱과 웹은 따로 로그아웃한다. 대신 **직접 누른 로그아웃(과 탈퇴)은 `/login?signedOut=1`에 도착한다**(HF-05) — 세션 만료의 `/login`과 구분되는 표시라, 앱 웹뷰가 보고 앱 토큰도 버린다. `global`로 서버에서 끊지 않고 신호로 넘긴 이유: 앱 쪽에서 로그아웃할 때는 어차피 앱이 토큰을 지우고, `global`은 **다른 기기의 앱·브라우저까지** 끊는다(공용 PC에서 로그아웃했다고 집 PC 앱이 풀릴 이유는 없다).
- **알려진 한계** — ① **PKCE가 없다.** 스킴을 가로챈 앱이 코드를 먼저 교환할 수 있다. 막으려면 `code_challenge`를 코드와 묶어 둘 저장소(또는 서명)가 필요해 P0에서는 보류했다. ② 브라우저가 이미 로그인돼 있으면 **확인 없이 그 계정으로** 넘어간다. 다른 계정을 원하면 웹에서 로그아웃하고 다시 시작한다. ③ 가입 확인 메일 링크는 템플릿이 `next=/dashboard`를 박아 두어(결정 12) 앱으로 돌아가지 않는다 — 확인 뒤 앱에서 로그인을 한 번 더 누르면 바로 넘어간다.
- **웹뷰에도 세션을 이어 준다 — `POST /api/v1/web-session`** (2026-09-25 핫픽스). 앱은 대시보드를 웹뷰로 띄우고, 그 웹뷰는 앱 세션(Bearer)과 별개인 **쿠키 세션**을 요구한다. 잇지 않았더니 두 가지가 터졌다. ① 앱 로그인 직후 웹뷰가 웹 로그인을 한 번 더 요구한다. ② macOS 웹뷰(WKWebView)의 Google 로그인은 **구조적으로 실패한다** — Google이 임베디드 웹뷰를 막아 앱이 off-host 이동을 시스템 브라우저로 넘기는데, `/auth/google`은 웹뷰 안에서 돌아 **PKCE 검증 쿠키가 웹뷰에** 남고 콜백은 브라우저에 도착한다 → `exchangeCodeForSession` 실패 → `oauth_failed`. 재시도는 브라우저 안에서 완결돼 **브라우저만** 로그인된다. 웹 단독으로는 못 고친다(Google 정책 + 세션이 사는 곳이 앱 프로세스 안).
  - **새 인증 경로를 만들지 않았다.** 딥링크와 같은 열쇠(`issueCode` — magiclink `hashed_token`)를 메일 링크와 같은 콜백 분기(`/auth/callback`의 `token_hash`)에 실어 URL 하나로 낸다. 웹뷰가 열면 쿠키 세션이 서고 `next`로 간다. 그래서 테이블도 폴링도 없다. 브라우저↔웹뷰 "페어링"으로 웹 단독 해결을 흉내 낼 수는 있지만 페어링 ID가 새면 계정 탈취라 택하지 않았다.
  - **권한이 늘지 않는다.** Bearer 보유자는 이미 API 전권을 가진다. 웹 세션이 더 여는 것은 설정·탈퇴 화면 정도이고, 그것도 같은 사용자다. 주소는 일회용·1시간이고 로그에 남기지 않는다.
  - **대가** — 위의 "새로 발급하면 이전 코드는 무효"가 여기에도 걸린다. 앱은 딥링크 코드 교환을 **끝낸 뒤** 부른다(계약에 명시). 사용자당 magiclink 하나라 비밀번호 재설정 메일과도 같은 자리를 다툴 수 있다 — 재설정 메일을 받아 둔 채 앱을 열면 그 링크가 죽을 수 있다. 드물어 받아들인다. 연달아 발급해도 막히지 않는 것은 `e2e/app-auth.spec.ts`가 실측한다.

### 19. 대시보드 시간대 — `profiles.timezone`을 서버가 읽고, 캡처가 갱신한다

`DASH-1`의 "오늘 마감" 판정과 날짜 표시에는 사용자 시간대가 필요하다. 화면은 `app/(app)/dashboard/page.tsx`, 계산은 `lib/time.ts`, 갱신은 `lib/api/captures.ts`.

- **서버 시간대를 쓰지 않는다.** 배포 환경(Vercel)은 UTC라 서울 사용자의 '오늘'이 9시간 어긋난다. 브라우저 시간대도 쓰지 않는다 — 화면을 서버가 그리므로 애초에 손에 들어오지 않고, 들어온다 해도 클라이언트 컴포넌트를 하나 여는 값이 아니다.
- **기준은 `profiles.timezone` 한 곳이다.** 이 컬럼은 `AGT-4`를 위해 처음부터 있었지만 **읽는 코드가 없었고** 가입 기본값(`Asia/Seoul`)으로만 채워졌다. 그래서 **캡처 API가 받은 `timezone`으로 이 값을 갱신한다** — 앱이 캡처마다 보내 주는 값이라 따로 설정 화면을 만들지 않아도 맞춰진다(메일 소스(P2)에는 보낼 앱이 없어 이 값이 유일한 근거가 된다).
- **갱신은 에이전트 호출과 병렬로 돌린다.** 캡처는 10초 예산(`AGT-9`)이 이미 빠듯해 왕복 하나도 앞에 세우지 않는다. `await` 없이 띄우고 `finally`에서 거두는데, **거두는 것이 핵심이다** — 서버리스 함수는 응답 뒤의 실행을 보장하지 않아 정말로 fire-and-forget 하면 로컬에서는 성공하고 프로덕션에서만 조용히 새는 버그가 된다. 이미 에이전트 시간만큼 지난 뒤라 실제 대기는 0에 가깝다. 실패는 삼킨다(시간대 갱신이 캡처 결과를 뒤집지 않는다).
- **오늘이면서 이미 지난 마감은 '마감 지남'으로 센다.** `DASH-1`이 둘 다 강조하라고 하므로 어느 쪽을 골라도 강조는 걸리고, 갈리는 것은 어느 색이 더 급한 사실을 말하느냐다. 결정 14가 날짜만 있는 마감을 23:59:59에 둔 덕분에 **날짜 마감은 그날 내내 '오늘 마감'으로 남고 자정에 넘어간다** — 두 종류가 각자 옳게 동작한다.
- **`lib/agent/time.ts`를 `lib/time.ts`로 옮겼다.** 화면과 에이전트가 같은 오프셋 계산을 쓴다. 대시보드가 `lib/agent/`를 import 하면 의존 방향이 뒤집히고, 복사하면 서머타임 버그가 한쪽에만 생긴다.

### 20. 웹의 쓰기는 Server Action이고, 로직은 Route Handler와 공유한다

상세 패널(`L-P0-12`)에서 브라우저가 처음으로 태스크를 쓴다. 쓰는 길을 둘 중 하나로 골라야 했다.

- **브라우저에서 `/api/v1/tasks`를 부른다** — 서버 코드를 한 줄도 안 고치지만, `withAuth`는 `Authorization: Bearer`만 보므로(계약 §인증) 브라우저가 쿠키 세션에서 액세스 토큰을 꺼내 실어야 한다. 그러려면 브라우저 Supabase 클라이언트와 클라이언트 컴포넌트가 필요하고, 낙관적 갱신 상태를 손으로 관리하게 된다.
- **Server Action** — `requireUser()` + `createServerSupabase()`가 `withAuth`의 짝이다. 화면이 이미 서버에서 그려지므로 새로 여는 것이 없다.

**Server Action을 골랐다.** 대시보드의 `"use client"`가 계속 **0건**으로 남고, 인증 화면이 이미 쓰는 규약(`app/(auth)/actions.ts`)을 그대로 따른다. 경계 1("앱은 Supabase 직접 호출 금지")과 충돌하지 않는다 — Server Action은 서버 코드이고, 브라우저가 Supabase에 직접 쓰는 것이 아니다.

**대신 쓰기 로직이 두 벌이 될 위험이 생겼다**(`API-5`). 그래서 RPC 호출과 DB 오류 해석을 `lib/api/tasks.ts`의 `insertTask`·`patchTask`·`removeTask`로 끌어올리고, Route Handler는 `ok`/`fail`로, Server Action은 `redirect()`로 **포장만 한다.** 경계는 "전송은 밖, DB는 안"이다 — 본문 파싱은 밖에 남되, FormData도 같은 모양의 객체로 만들어 **같은 `parseTaskFields`를 지난다.** 검증이 두 벌이 되면 "마감이 없으면 시각도 없다"(결정 14, DB CHECK와 짝)가 한쪽에서만 지켜진다.

**태그도 같은 이동을 했다**(`L-P1-06`). 이름 변경·삭제가 Route Handler 안에 인라인이던 것을 `lib/api/tags.ts`의 `renameTag`·`removeTag`로 끌어올리고(병합은 `L-P1-05`부터 거기 있었다), 라우트는 `ok`/`fail` 포장만 남겼다. **응답은 한 바이트도 안 움직였고** `e2e/tags.spec.ts` 17건이 한 줄도 안 고쳐지고 통과하는 것이 그 증거다. 한 가지가 딸려 왔다 — 화면은 사유별 문장을 띄워야 하는데 `code`(`VALIDATION_FAILED`)가 서로 다른 실패 셋을 삼키므로, `revertJobLog`가 `L-P1-04`에서 그랬듯 **`reason` 칸을 더했다.** 봉투에는 굵은 `code`가 맞고 화면에는 잘게 쪼갠 `reason`이 맞다. Route Handler는 그 칸을 읽지 않는다.

**화면 상태는 전부 URL에 둔다** — 열린 태스크 `?task=`, 새 태스크 `?new=1`, 태그 관리 `?tags=1`, 실패 `?error=`. 클라이언트 상태를 만들지 않아도 되고, **`NTF-2`의 딥링크가 따로 만들 것 없이 따라온다.** 패널이 하나뿐이라 셋 사이의 우선순위가 필요해졌고, 그것이 `app/(app)/dashboard/url.ts`의 `panelOf` **한 곳**에 산다([`05-UI-Spec.md`](05-UI-Spec.md) §태스크 상세 패널). `"use server"` 파일은 모든 export가 async 함수여야 해 `actions.ts`에 둘 수 없었다.

- **성공은 `refresh()` 뒤에 `redirect(…, replace)`로 끝낸다.** 둘 다 부르는 것이 의도다. `refresh()`가 없으면 URL이 그대로일 때 현재 라우트가 다시 그려지지 않고(Next 16 Server Actions 가이드: *"An action that does none of the above … the current route is not re-rendered"*), `redirect()`가 없으면 앞선 실패가 남긴 `?error=`가 주소에 남아 **고쳐서 저장했는데도 에러 문구가 계속 보인다.**
- **`redirect()`는 Server Action에서 기본이 `push`다.** 삭제·실패를 push로 두면 뒤로가기가 지워진 태스크의 패널로 돌아간다. 그래서 `RedirectType.replace`를 명시하고, **생성만 push**로 남긴다 — 뒤로가기로 빈 폼에 돌아오는 것이 맞다.
- **`revalidatePath`는 쓰지 않는다.** `/dashboard`는 쿠키를 타서 요청마다 동적으로 렌더되므로 무효화할 캐시가 없다. `app/(auth)/actions.ts`가 그것을 쓰는 이유는 로그인 상태가 **레이아웃**에 걸려 있어서다 — 같은 상황이 아니다.
- **시간대는 폼이 아니라 DB에서 읽는다**(`userTimeZone()`). 숨은 칸으로 나르면 위조된 값으로 마감이 몇 시간 밀린 채 저장된다.

### 21. 실시간 반영 — 구독은 신호만 나르고, 목록은 여전히 서버가 그린다

결정 3이 정한 것은 **경계**("브라우저 대시보드는 예외적으로 Supabase를 직접 구독한다")이고, 여기서 정하는 것은 그 **구현**이다(`L-P0-13`).

**목록 데이터를 클라이언트로 옮기지 않는다.** `app/(app)/dashboard/realtime.tsx`는 `tasks`의 변경을 듣고 `router.refresh()`만 부른다. 페이로드는 보지도 않는다.

- Realtime의 `postgres_changes`는 **`tasks` 행 하나만** 준다 — `task_tags(tags(...))` 조인이 없다. 그것으로 목록을 그리려면 `DASH-1` 3단 정렬, 태그 칩, `?tag=` 필터가 그 행에 걸리는지의 판정, `profiles.timezone` 기준 마감 강조를 **브라우저에 한 벌 더 복제**해야 한다. 그 규칙들이 `lib/api/tasks.ts` 한 자리에 모여 있다는 것이 `L-P0-11`·`L-P0-12`가 지켜 온 것이다(결정 19·20).
- 대가는 RSC 왕복 한 번이고, 얻는 것은 **화면 코드가 한 벌로 남는 것**이다. `"use client"`는 1건으로 늘었지만 **데이터는 여전히 클라이언트에 없다.**

**`event: "*"`를 쓰지 않는다 — INSERT와 UPDATE를 따로 바인딩한다.** DELETE 이벤트에는 RLS가 적용되지 않고(지워진 행의 접근 권한을 Postgres가 확인할 방법이 없다), `replica identity`가 기본값이면 PK가 아닌 컬럼의 필터(`user_id=eq.…`)마저 무시된다. 즉 `*`로 구독하면 **남의 태스크 id가 브라우저로 흘러든다.** 듣지 않는 것이 거르는 것보다 확실하다.

**`replica identity full`로 올리지 않는다.** 얻는 것은 DELETE 이벤트의 필터링뿐인데 애초에 DELETE를 구독하지 않고, 대가로 UPDATE마다 옛 행 전체가 WAL에 실린다. 포기하는 것 둘 — 다른 탭·앱에서 지운 태스크가 이 탭에서 즉시 사라지지 않는다(에이전트는 삭제하지 않고, 웹 삭제는 그 탭이 이미 다시 그린다), **태그만 바꾼 저장도 반영되지 않는다**(`task_tags`는 publication에 없고 `tasks` 행이 변하지 않는다).

**구독 전에 세션이 복원되기를 기다린다**(`await supabase.auth.getClaims()`). 브라우저 클라이언트를 만든 직후에는 쿠키를 아직 읽지 않아 토큰이 비어 있고, 그대로 구독하면 join이 **익명으로 나가 RLS가 모든 행을 막는다.** 증상이 고약하다 — 채널은 `SUBSCRIBED`가 되는데 이벤트만 영영 오지 않는다(L-P0-13에서 실제로 밟았다). 반면 `setAuth()`는 **직접 부르지 않는다**: supabase-js가 `INITIAL_SESSION`·`TOKEN_REFRESHED`에서 자동으로 부르고, 수동 호출은 "수동 토큰" 모드를 켜서 오히려 자동 갱신을 끈다.

**채널 topic에 마운트마다 다른 접미사를 붙인다.** `RealtimeClient.channel(topic)`은 같은 topic이 이미 있으면 그 객체를 그대로 돌려주고, `subscribe()`는 채널이 닫혀 있을 때만 join을 보낸다. App Router는 StrictMode가 기본이라 mount → cleanup → mount가 도는데, topic이 고정이면 두 번째 mount가 아직 닫히는 중인 첫 채널을 받아 **아무것도 구독하지 않은 채 끝난다** — dev에서만 죽고 prod에서는 사는 모양이다.

**`SUBSCRIBED`가 설 때마다 한 번 따라잡는다 — 첫 구독도 예외가 아니다.** Realtime은 끊긴 동안의 변경을 재생해 주지 않는다(at-most-once). 재연결이야 당연하고, **첫 구독에도 틈이 있다**: 서버가 화면을 그린 시각과 채널이 서는 시각 사이(세션 복원 왕복만큼)에 들어온 변경은 아무도 보지 못한다. "방금 그린 화면이니 낭비"라며 건너뛰었다가 그 틈으로 태스크가 새는 것을 테스트가 잡았다. 대가는 페이지 로드마다 RSC 왕복 한 번이다. `visibilitychange`는 **쓰지 않는다** — 탭을 숨겨도 WebSocket은 닫히지 않고, 정말 끊겼다면 재연결이 같은 경로를 탄다.

**이벤트는 200ms로 접는다.** 캡처 한 장이 태스크 여러 건을 만들고(`lib/agent/create.ts`가 한 건씩 `create_task`를 부른다) 접지 않으면 INSERT마다 서버를 다시 불러 중간 상태(1건 → 2건 → …)를 차례로 그린다. 같은 탭의 Server Action이 이미 `refresh()`를 부른 뒤 Realtime 이벤트가 또 오는 중복은 **그냥 둔다** — `router.refresh()`는 멱등하고 클라이언트 상태와 스크롤을 보존한다.

> ⚠️ **브라우저 클라이언트가 생기면서 토큰 갱신 주체가 둘이 됐다** — `proxy.ts`(결정 10)와 브라우저의 `autoRefreshToken`. `@supabase/ssr`의 표준 구성이고 리프레시 토큰 회전의 재사용 유예가 동시 갱신을 흡수하므로 끄지 않았다. 다만 **"가끔 로그아웃된다"가 나타나면 첫 용의자가 여기다.**

### 22. 배포 — 함수는 서울에서 돌고, 플랫폼 상한은 우리 예산보다 길다

`vercel.json`(리전)과 `app/api/v1/captures/route.ts`(`maxDuration`). L-P0-14에서 정했다.

- **리전을 `icn1`(서울)로 고정한다.** Vercel 기본은 `iad1`(버지니아)인데 Supabase는 `ap-northeast-2`다. 캡처 한 건은 LLM을 **한 번** 부르고 DB는 여러 번 왕복한다(태그 읽기 → 로그 → `create_task`×N → 시간대 갱신). 대륙을 건너는 구간은 왕복이 적은 쪽에 몰아 주는 것이 싸다. 실측으로 확인했다 — 배포본의 **LLM 밖 오버헤드가 0.5초**로 로컬(0.6초)과 같고 전체도 6.0초 대 6.5초다. 첫 호출만 콜드 스타트로 1.8초까지 뛴다.
- **`maxDuration = 20`.** 우리 예산(10초)보다 **길게** 잡는다. 같거나 짧으면 플랫폼이 먼저 함수를 죽여 봉투 밖의 504가 나가고 `AGENT_TIMEOUT` 로그도 남지 않는다 — 결정 17의 "504면 반영된 것이 없다"가 통째로 무너진다. Vercel 기본값은 fluid compute 기준 300초라, 이 값은 상한을 늘리는 것이 아니라 폭주를 막으려고 **줄이는** 쪽이다.
- **사이트 주소를 환경변수로 두지 않는다.** 리다이렉트는 전부 요청의 `origin`에서 만든다(`app/(auth)/actions.ts` · `/auth/callback` · `/auth/google`). 그래서 도메인이 늘어도 코드가 그대로다. 런타임 환경변수는 **넷뿐이다** — Supabase URL · publishable 키 · secret 키 · OpenAI 키. `SUPABASE_DB_PASSWORD`는 로컬 CLI 전용이라 배포에 넣지 않는다.
- **대가는 Supabase 쪽에 있다.** origin을 믿는 만큼 Supabase Auth의 **Site URL · Redirect URLs**에 배포 도메인이 등록돼 있어야 Google 로그인과 메일 링크가 산다. 이건 **대시보드에서 손으로** 맞춘다. `supabase config push`로 저장소에 SSOT를 두는 쪽이 매력적이지만 푸시 범위가 공식 문서에 없고 dry-run도 없다 — `config.toml`에 없는 필드까지 덮으면 대시보드에만 있는 **Resend SMTP와 `token_hash` 메일 템플릿(결정 12)** 이 날아간다. 검증하지 못한 파괴적 명령은 쓰지 않는다.
- **허용 목록이 맞는지는 "바꿔치기"로 확인한다.** Supabase는 허용 목록에 없는 `redirect_to`를 **거부하지 않고 조용히 Site URL로 갈아끼운다** — 그래서 화면만 봐서는 설정이 틀린 것을 알 수 없고, 자동 테스트도 `token_hash`를 직접 실어 이 경로를 타지 않는다. 확인하려면 `POST /auth/v1/admin/generate_link`에 주소를 실어 보내고, 돌아온 `action_link`의 `redirect_to`가 **보낸 것과 같은지** 본다. 다르면 허용되지 않은 것이고, **그 대체된 값이 곧 현재 Site URL이다**(미등록 주소를 일부러 넣으면 Site URL을 읽어낼 수 있다). 메일을 보내지 않고, 아무것도 바꾸지 않는다.
- **Google Cloud Console은 배포 도메인과 무관하다.** Google에 등록된 `redirect_uri`는 **Supabase의 콜백**(`…supabase.co/auth/v1/callback`) 하나뿐이고, 우리 도메인은 그 뒤 단계(Supabase → `redirect_to`)에만 나온다. 도메인이 바뀌어도 Google 쪽은 건드리지 않는다.

### 23. 디자인 시스템 — 키트 원문은 사본으로 두고, Tailwind 별칭을 그 위에 판다

`app/globals.css`와 `app/layout.tsx`. `L-DS-01`~`L-DS-03`에서 정했다. 규칙과 토큰 목록은 [`08-Design-System.md`](08-Design-System.md).

- **토큰을 2층으로 갈랐다.** 1층은 키트(`tide-kit-v3.0/web/tide-tokens.css`)의 **사본**이고 평범한 `:root`다. 2층(`@theme`)이 Tailwind 네임스페이스로 별칭을 연다. 갈라야 했던 이유는 이름 충돌이다 — 키트의 `--text-secondary`를 `@theme`에 그대로 넣으면 Tailwind가 **글자 크기** 네임스페이스(`--text-*`)로 읽어 `text-secondary`가 색이 아니라 font-size 유틸리티가 된다. 1층을 `@theme` 밖에 두면 Tailwind가 파싱하지 않으므로 키트 원문을 글자 하나 바꾸지 않고 보관할 수 있고, 키트가 갱신되면 복사-붙여넣기 한 번으로 끝난다.
- **기본 팔레트와 타입 스케일을 `initial`로 비웠다.** 키트의 QA 규칙("화면에 회색·인디고·빨강 말고 다른 색이 없어야 한다")을 새 코드가 어기지 못하게 하려는 것이다. ⚠️ 다만 **빌드 게이트가 아니다** — Tailwind v4는 모르는 유틸리티를 에러 없이 조용히 버린다(에러가 나는 곳은 `@apply` 경로뿐). 남은 `bg-gray-50`은 lint도 build도 통과하면서 스타일만 사라진다. 그래서 **켜는 순서가 중요했다**: 모든 화면을 역할 토큰으로 옮긴 뒤(`L-DS-03`) 마지막에 켰다. 진짜 그물은 커밋 전 grep이다(08 문서 §커밋 전 확인).
- **간격은 비우지 않았다.** Tailwind 4.3.3의 `--spacing`은 스케일이 아니라 **곱셈 단위 하나**(`0.25rem`)라 덮으면 `w-80`·`max-w-*`까지 함께 바뀐다. 그런데 키트의 일곱 단계(4·8·12·16·24·32·48)가 Tailwind 기본의 `1 2 3 4 6 8 12`와 정확히 같아 덮을 이유가 없었다.
- **한글 웹폰트는 버전을 박은 CDN에서 받는다.** 키트에는 데스크톱용 `.otf`/`.ttf`만 있고 웹폰트가 없다. 가변 woff2 전체를 저장소에 넣으면 3.35MB가 늘고 사용자도 그만큼 받는다. Pretendard는 **동적 서브셋**이라 화면에 실제로 뜬 글자 조각만 받고, Wanted Sans는 제목에만 쓰여 split으로 충분하다. 주소에 `@v1.3.9`·`@v1.0.3`을 박은 것은 `package.json`에 캐럿을 쓰지 않는 것과 같은 이유다.
  - **대가: 외부 CDN 의존이 하나 생겼다.** jsDelivr이 막히면 한글이 시스템 폰트로 떨어진다 — 화면은 읽히지만 조판이 달라진다. 키트 토큰의 폴백 스택이 그 자리를 받는다. 자체 호스팅으로 옮기려면 woff2 서브셋 툴체인(`pyftsubset`)과 빌드 단계가 새로 생기므로, 오프라인이 요구사항이 되는 날 다시 본다.
  - `next/font`를 쓰지 않은 것도 같은 이유다. 두 서체 모두 npm 패키지가 아니고, `next/font/local`에 키트의 정적 폰트를 그대로 실으면 서브셋이 되지 않는다.
- **React 19의 `<link rel="stylesheet">`를 루트 레이아웃에서 직접 그린다.** App Router에서 `<head>`를 손으로 쓰지 않는 길이고(Next 16 §CSS), `@import`로 부르면 CSS가 CSS를 부르는 직렬 워터폴이 생긴다.
- **다크 모드를 지원하지 않는다.** 키트 v3.0이 명시적으로 범위 밖으로 두어 다크 팔레트가 아예 없다. `:root { color-scheme: light }`로 브라우저가 폼 컨트롤을 임의로 반전시키는 것까지 막는다 — 막지 않으면 인디고 하나뿐이어야 할 화면에 브라우저가 고른 색이 섞인다.

### 24. 작업 로그 조회 — 두 방향을 한 배열로, 계측은 타입에서 잘라 낸다

`GET /api/v1/job-logs`(`HIST-1`). 조회는 `lib/api/job-logs.ts`의 `listJobLogs()` + `toJobLogPayload()`이고 라우트는 봉투만 씌운다 — `L-P1-03`의 `/history` 화면이 같은 함수를 부른다(`API-5`).

- **`tasks`가 `job_logs`를 두 칸으로 참조하게 되면서 임베딩이 모호해졌다.** 생성은 `job_log_id`, 완료는 `completed_by_job_log_id`다. 힌트(`tasks!job_log_id(...)`)로 어느 칸인지 밝히는데, 밝히지 않으면 **런타임이 아니라 `npm run typecheck`가** `SelectQueryError`로 잡는다. 제약 이름 대신 컬럼 이름을 힌트로 쓴 것은 읽을 때 어느 칸인지 바로 보이고 제약 이름 변경에 묶이지 않아서다.
- **두 임베딩을 한 배열로 합쳐 내보낸다.** 한 로그가 둘을 동시에 채울 수 없기 때문이다 — `capture_create`·`mail`은 `job_log_id`만, `capture_complete`는 `completed_by_job_log_id`만 심는다. 나눠 보내면 읽는 쪽이 늘 빈 배열 하나를 무시하는 코드를 쓰게 되고, 어느 쪽이 찼는지는 `source`가 이미 말한다.
- **정렬은 매퍼가 고정한다.** PostgREST 임베딩은 순서를 보장하지 않아 그대로 두면 같은 로그가 요청마다 달라 보인다. `toTaskPayload`가 태그를 이름순으로 고정한 것과 같은 자리·같은 이유다.
- **계측 칸은 `Pick`으로 타입에서 잘라 낸다.** `Omit<Row, "user_id">`로 두면 새 계측 칸이 생길 때 조용히 따라 들어온다. "싣지 않는다"가 주석이 아니라 컴파일러의 사실이어야 한다.
- **최신 100건 고정.** 커서를 열면 앱과 화면 양쪽에 페이지 상태가 늘고, 지금 필요한 것은 "최근에 무슨 일이 있었나"뿐이다. 나중에 더하는 변경으로 열 수 있다.
- **`completed_by_job_log_id is not null → status = 'done'` CHECK를 걸지 않는다.** 되돌리기가 태스크를 `todo`로 되돌리면서 연결은 남기므로(되돌림 플래그를 따로 두지 않는 설계) 그 조건이 깨진다. `L-P1-02`가 그렇게 구현해 실증했다 — §설계 결정 25.

### 25. 되돌리기 — 판정은 SQL 하나가 하고, 조건은 쓰기 문장의 WHERE에 산다

`POST /api/v1/job-logs/:id/revert`(`HIST-3`·`HIST-4`). 마이그레이션 `20260924073441_revert_job_log.sql`의 두 함수 + `lib/api/job-logs.ts`의 `revertJobLog()`.

- **판정이 사는 곳은 한 군데다.** `revert_blocked_reason(job_logs)`가 "되돌릴 수 없는 사유"(되돌릴 수 있으면 `null`)를 돌려주고, 목록의 `revertable`은 **PostgREST 계산 컬럼**으로 같은 함수를 읽는다. TypeScript가 조건을 다시 적지 않으므로 화면의 버튼과 실제 결과가 갈라질 수 없다. `lib/agent/complete.ts`가 P0에서 "판정 조건은 `revert_job_log`의 WHERE 하나"라고 선언해 둔 것을 지킨 것이다.
- **계산 컬럼의 인자에는 이름이 없다** — `p_` 접두사 규칙의 유일한 예외다. PostgREST는 무명 인자여야 계산 컬럼으로 읽고(동시에 RPC로는 노출하지 않는다), `postgrest-js`의 `ComputedField` 타입도 `Args: { "": Row }` 형태만 인정한다. 생성 타입에서 이 함수의 `Returns`가 에러 문자열로 나오는 것이 정상이고, 그것이 곧 "RPC로 부를 수 없다"는 표시다. 계산 컬럼은 `select("*")`에 실리지 않으므로 `JOB_LOG_SELECT`가 이름을 적는다.
- **쓰기는 사유 함수를 믿지 않는다.** 조건 전부가 `delete`/`update`의 WHERE에 들어 있고, 0행이 나왔을 때에만 사유 함수를 불러 "왜"를 붙인다. 사유로 먼저 분기하면 검사와 쓰기 사이에 창이 생긴다 — 판정은 쓰기가, 설명은 사유 함수가 한다.
- **생성 되돌리기의 all-or-nothing을 문장 하나의 성질로 만들었다.** `locked` CTE가 후보를 `for update`로 잠그기만 하고, `delete … where not exists (수정된 행)`이 판정을 들고 있다. 조건이 행마다 달라지지 않아 전체가 통째로 지워지거나 한 건도 안 지워진다. 대안 둘을 버렸다 — *별도 `select … for update` 문장*은 판정을 쓰기 밖으로 내보내고, *삭제 행 수 비교 후 되돌리기*는 롤백에 `raise exception`이 필요한데 저장소에 그 패턴이 0건이다. 잠그지 않으면 read committed에서 **커밋된 사용자 편집을 못 보고 지운다** — `HIST-4`가 막으려는 바로 그 일이다.
- **결과를 예외가 아니라 행 모양으로 알린다**(`returns table`). 0행 = 없거나 남의 로그(→`404`), `blocked_reason` = 되돌릴 수 없음(→`409`), `reverted`·`task_ids` = 성공. `set_task_tags`가 `false`로 알리는 것과 같은 태도이고, 예외로 나르면 호출부가 errcode 문자열에 묶인다. `jsonb` 대신 표를 고른 것은 `reverted`가 생성 타입에서 `job_outcome` 열거형으로 잡히기 때문이다.
- **갈래는 `source`가 아니라 `outcome`으로 가른다.** `source`는 입력이 어디서 왔는지를, `outcome`은 DB에 무엇이 쓰였는지를 말하고, 되돌리기는 쓰인 것을 되돌리는 일이다. 덕분에 `source='mail'`인 생성 로그가 분기 없이 생성 갈래를 타고, `source='capture_create'`인데 `outcome='failed'`인 로그가 생성 갈래로 잘못 들어가지 않는다. `public/api.md`가 앱에 "`outcome`의 값은 늘지 않는다"고 약속한 축이기도 하다.
- **`TASK_MODIFIED`를 완료 갈래에 걸지 않는다.** 완료 캡처가 `status`를 쓴 것 자체가 `updated_at`을 올려 완료된 태스크는 **항상** `updated_at <> created_at`이다. 걸면 완료 되돌리기가 100% 막힌다. 완료 쪽의 `HIST-4`는 `status='todo'`와 연결 소실이 이미 전부 덮는다.
- **구분할 수 없는 것을 구분한다고 말하지 않는다.** "태스크가 지워짐"과 "다른 캡처가 다시 닫아 연결이 덮임"(결정 16)은 서버에서 같은 관측(가리키는 행 0건)으로 수렴한다. 그래서 코드도 문장도 하나로 두고, 둘 다에서 참인 *"되돌릴 태스크가 남아 있지 않습니다."* 를 쓴다. `L-P1-01`이 "사용자가 그 사이 수정함"에서 '사용자가'를 뺀 것과 같은 규율이다.
- **되돌림 플래그를 두지 않는다.** 생성은 태스크가 사라져서, 완료는 `status='todo'`라서 재실행이 자연히 0행이 된다. 상태를 플래그와 실제 데이터 두 군데에 적으면 갈라진다. `job_outcome`·`source_kind`에도 값을 더하지 않았다 — 되돌리기는 사용자 조작이지 에이전트 작업이 아니다.
- **완료 되돌리기는 연결을 남긴다**(사용자 결정 2026-09-24). 지우면 그 로그의 '관련 태스크' 표시가 영구히 비어 계약의 약속과 어긋난다. ⚠️ 대가 — 되돌린 뒤 사용자가 직접 다시 완료하면 같은 로그의 되돌리기가 **다시 가능해지고**, 그것은 사용자의 수동 완료를 `todo`로 만든다. 알려진 한계로 받아들였다(ROADMAP `L-P1-02`). 삭제와 달리 상태 전환은 되돌릴 수 있다는 것이 근거다.
- **이 패턴의 두 번째 사례가 `merge_tags`다**(`L-P1-05`). 판정 넷이 `delete`의 WHERE 하나에 있고, 0행일 때에만 사유를 되묻고, 결과를 `returns table`의 행 모양으로 나른다 — `blocked_reason`이 있으면 거절, 태그 한 건이면 성공이다. ⚠️ 거기서 만난 함정 하나: **`returns table`의 칸 이름은 본문에서 plpgsql 변수가 된다.** `revert_job_log`는 OUT 이름(`reverted`·`task_ids`)이 어느 테이블 칸과도 안 겹쳐 무사했지만, `merge_tags`는 `id`·`name`을 그대로 써야 해서(응답이 `toTagPayload`를 지난다) 본문의 모든 칸 참조를 별칭으로 한정했다. 안 하면 런타임에 `42702`다.
- **계산 컬럼 때문에 `tasks_job_log_id_idx`가 필요해졌다.** `L-P1-01`은 이 칸의 인덱스를 일부러 비웠는데(임베딩은 `IN` 목록 한 번이라 사용자 범위 스캔으로 충분했다) 계산 컬럼은 목록 100건마다 점조회를 해 전제가 깨졌다. `completed_by_job_log_id`와 대칭으로 부분 인덱스를 열었다.

### 26. 앱 셸 — `layout.tsx`가 아니라 컴포넌트다

`/dashboard`·`/history`가 나눠 쓰는 인디고 사이드바(`L-P1-03`). 파일은 `app/(app)/shell.tsx` 하나이고 각 화면이 그것을 부른다. 화면 구성은 [`05-UI-Spec.md`](05-UI-Spec.md) §앱 셸.

- **레이아웃으로 올리지 못하는 이유가 프레임워크에 있다.** Next 16의 레이아웃은 네비게이션에서 **다시 그려지지 않는다** — 그래서 `pathname`도 `searchParams`도 읽을 수 없고, 공식 해법은 `usePathname`·`useSearchParams`를 쓰는 클라이언트 컴포넌트다(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` §Query params·§Pathname). 그런데 이 사이드바가 그려야 하는 표지 **둘이 정확히 그 둘에 걸려 있다**: 주요 메뉴의 `aria-current`(경로)와 태그 필터의 선택(`?tag=`).
- **그래서 레이아웃을 골랐다면 `"use client"`가 늘었을 것이다.** 클라이언트 컴포넌트는 브라우저만 할 수 있는 일에만 쓴다(결정 28) — 선택 표지 하나는 거기 들지 않는다.
- **덤으로 데이터가 낡지 않는다.** 레이아웃이 태그 목록을 읽었다면, 레이아웃이 다시 그려지지 않는 성질 때문에 화면을 옮겨 다닐 때 **옛 목록이 남는다.** 컴포넌트는 페이지와 함께 매번 서버에서 그려져 그 창이 없다.
- **대가는 강제력이다.** 새 화면이 셸을 부르는 걸 잊으면 사이드바가 없다 — 레이아웃이었다면 자동으로 씌워졌다. 화면이 셋뿐이고 각 화면의 스펙이 사이드바를 보므로 감수했다(사용자 결정 2026-09-24). 잊는 순간 그 화면의 스펙이 먼저 빨간불이 된다.
- **`(app)` 라우트 그룹은 남긴다.** URL은 바뀌지 않고(`/dashboard`는 그대로다), 셸을 쓰는 화면들이 한 폴더에 모여 공유 문구(`app/(app)/messages.ts`)가 놓일 자리가 생긴다. 그룹에 `layout.tsx`를 두지 않는 것은 위의 이유다.
- **선택 표지는 한 컴포넌트가 낸다.** `components/ui.tsx`의 `SidebarLink`를 주요 메뉴와 태그 필터가 함께 쓴다 — 둘 다 "누르면 화면이 바뀌는 것"이라 모양을 가르면 같은 뜻의 표지가 두 벌이 된다. 무엇을 고르는 네비인지는 `<nav>`의 `aria-label`이 말한다.

### 27. 중복 감지 — 같은 호출 안에서, 후보 번호 enum으로

`AGT-11`(`L-P1-08`). `lib/agent/create.ts`의 `loadOpenTasks()`·`planCreate()`, 스키마는 `lib/agent/create-prompt.ts`의 `buildCreateSchema()`.

- **LLM 호출을 늘리지 않는다.** 생성 호출의 각 태스크에 `duplicateOfKey` 칸을 두고 한 번에 판정한다. 두 번째 호출은 p90 꼬리를 둘로 만들어 10초 예산(`AGT-9`)이 즉사한다. `e2e/agent-create.spec.ts`가 `analyzeImage` 호출 자리가 하나인지를 소스로 확인한다.
- **서버의 문자열 비교는 대안이 아니다.** "Excel 문서 회신"과 "엑셀 문서 작성해서 회신하기"는 문자열로 같지 않고, 요구사항의 판정 주어가 "에이전트"다.
- **후보는 결정 16의 패턴을 그대로 빌린다** — 번호로 보여 주고, 번호 enum + null을 요청마다 스키마에 박고, 번호 → id는 서버가 쥔다. 후보 0건이면 `{type:"null"}`만.
- **후보는 최근에 만든 미완료 40건, 제목만.** 상한은 로드맵의 사후 대책이던 것을 처음부터 걸었다(사용자 결정 2026-09-25) — 평가 세트의 태스크 수로는 미완료가 수백 건인 계정의 지연을 재현할 수 없어서, 배포 뒤에야 터질 위험을 미리 막았다. 최근순인 이유는 중복이 대개 가까운 캡처끼리 생기기 때문이다. 대가: 40건 밖의 오래된 태스크와 같은 일은 새로 만들어진다. 마감·태그를 싣지 않는 것은 판정이 대상과 행동으로 갈리기 때문이다 — 줄마다 토큰이 줄고 추론이 줄면 그것이 곧 지연이다.
- **오판 비용이 비대칭이다.** 새 일을 중복으로 잘못 묶으면 그 할 일이 **목록에서 사라지고**, 중복을 놓치면 사용자가 하나를 지우면 된다. 그래서 프롬프트는 "애매하면 null", 서버는 후보에 없는 번호를 중복이 아닌 것으로 친다.
- **분기는 순수 함수 `planCreate()`에 있다** — 전부 중복이면 `failed` + `DUPLICATE_TASK`, 일부면 `created` + `duplicates`, 할 일이 없으면 기존 `NO_TASK_TO_CREATE`. DB도 LLM도 건드리지 않아 테스트가 세 갈래를 결정적으로 밟는다(결정 17의 선례). 모델이 같은 일을 알아보는지는 `npm run grade`의 `create/07-duplicate`만 본다(L4).
- **`message`에 기존 제목을 싣는다.** 알림 본문이 곧 `message`이고, "이미 있다"만으로는 무엇이 있는지 알 수 없다. 기존 `NO_TASK_TO_CREATE` 재사용을 버린 이유도 이것이다(ROADMAP §착수 전에 정해 둔 것).
- **작업 로그의 `rationale`에 중복 근거를 싣지 않는다.** 계약(`public/api.md` §작업 로그)이 그 칸을 "완료 처리에서만 찬다"고 적어 두었고 그 문서는 추가만 한다. 그래서 히스토리는 무엇과 겹쳤는지를 보여 주지 못하고 사유 문장만 띄운다 — 무엇과 겹쳤는지는 캡처 응답의 `duplicates`가 알림으로 나른다. 일부 중복의 로그는 `created`라 겹친 것의 흔적이 히스토리에 없다. 둘 다 알려진 한계다.

### 28. 클라이언트 컴포넌트 — 브라우저만 할 수 있는 일에만, 지금 셋

`"use client"`를 세지 않고 **무엇이 그 파일에 들어갈 수 있는지**로 긋는 선이다. 기준은 하나 — **서버가 그릴 수 없는 일인가.** 세 파일이 그 기준을 통과했고, 셋 다 데이터를 읽지 않는다.

| 파일 | 서버가 못 하는 이유 | 든 것 |
|---|---|---|
| `app/(app)/dashboard/realtime.tsx` | 남의 탭에서 생긴 변경을 들어야 한다 | 구독 하나, 마크업 없음 (결정 21) |
| `app/(auth)/password-input.tsx` | 입력의 `type`을 오가야 한다 | `useState` 하나 |
| `app/(app)/shortcuts.tsx` | 사이드바에서 플랫폼을 골라 본다 | `useState` 하나 |

- **뒤의 둘은 앱 부서 보고(HF-02)에서 왔다.** 앱 웹뷰에는 비밀번호를 확인할 길이 전혀 없었다 — Edge가 비밀번호 칸에 얹는 기본 눈 버튼(`::-ms-reveal`)은 브라우저 셸의 UI라 **WebView2에서는 그려지기만 하고 눌리지 않고**, macOS WKWebView에는 아예 없다. 브라우저에서만 멀쩡한 종류의 고장이라 우리 눈에 보이지 않았다.
- **URL 왕복으로 피하지 않았다.** `?show=1` 같은 칸을 쓰면 비밀번호가 주소에 실리거나(그대로 기록에 남는다) 화면이 다시 서면서 입력이 지워진다. `type` 한 글자를 위해 치르기에는 둘 다 크다.
- **폼 제출은 여전히 Server Action이 받는다.** 클라이언트가 얻은 것은 `type` 하나이고, 값은 `name="password"`로 평범하게 제출된다 — JavaScript가 죽어도 로그인은 된다(토글만 안 움직인다).
- **단축키의 기본 플랫폼은 서버가 고른다.** `shell.tsx`가 `Sec-CH-UA-Platform`(Chromium 계열은 늘 보낸다 — WebView2가 여기 해당한다), 없으면 User-Agent로 가려 초깃값을 프로퍼티로 넘긴다. 클라이언트에서 `navigator`를 보면 서버가 그린 화면과 달라져 하이드레이션 경고가 뜨거나 한 프레임 다른 플랫폼이 보인다. **틀려도 손해가 없다** — 버튼으로 한 번에 바꾼다.
- **고른 플랫폼을 저장하지 않는다.** 화면을 옮기면 자기 플랫폼으로 돌아온다 — 앱은 한 OS에서만 돌고, 토글은 "남의 OS를 한번 보는" 자리다. `localStorage`를 쓰면 쓰기가 막힌 웹뷰를 감싸는 방어 코드가 따라붙는다.

### 29. 확인 필요 — 로그에 시각 한 칸, 범위는 서버 한 곳

`DASH-11`의 토대(`L-P1-11`). 실패한 생성 캡처를 사용자가 처리했는지를 `job_logs.handled_at`(null = 아직) 한 칸으로 담는다.

- **새 테이블이 아니라 칸 하나다.** 처리 여부는 로그 한 건에 딸린 사실이라 1:1이고, 새 테이블은 RLS 정책과 조인을 하나씩 늘린다. 불리언 대신 **시각**이라 "언제 처리했나"를 공짜로 얻는다.
- **새 RLS 정책이 없다.** "본인 작업 로그만"(`for all`)이 본인 행의 update를 이미 허용하고, 남의 행은 0행으로 만든다. `markLogHandled`는 오류 없이 끝나므로 없는 로그·남의 로그·이미 처리한 로그가 같은 결과로 합류한다(결정 9).
- **범위 조건은 `lib/api/job-logs.ts`의 `NEEDS_REVIEW` 한 곳에 있고 부분 인덱스가 같은 조건이다.** 건수(배지)와 목록이 같은 필터 함수를 지나 갈라질 수 없다. 둘이 어긋나면 쿼리가 인덱스를 못 탈 뿐 결과는 맞다 — 틀리는 쪽이 아니라 느려지는 쪽으로 망가진다. `handledAt` 칸만으로는 "확인 필요에 남았나"를 판정할 수 없게 둔 것도 같은 이유다(범위 밖 로그는 늘 null) — 앱이 범위를 다시 적지 않게.
- **처리 표시는 쓰기 쪽에서 범위를 다시 검사하지 않는다.** 범위 밖 로그에 칸이 차도 보이는 차이가 없어서다.
- **`createTask`는 처리 표시 실패를 삼킨다.** 태스크는 이미 저장됐는데 던지면 사용자가 다시 저장해 같은 태스크가 둘이 된다. 대가는 항목이 목록에 남는 것뿐이다.
- **목록에 개수 제한이 없다**(히스토리의 100건과 다르다). 비워 가는 목록이라 작고, 자르면 배지 숫자와 목록이 어긋난다.

### 30. 개인정보처리방침 동의 — 프로필에 시각 한 칸, 판정은 두 입구에서

`AUTH-6`(HF-06). 방침 동의와 만 14세 이상 확인을 한 화면(`/consent`)에서 함께 받고 `profiles.consented_at`(null = 미동의) 한 칸에 담는다.

- **불리언이 아니라 시각이다**(결정 29와 같은 이유). 둘을 한 번에 받으므로 칸도 하나다.
- **기존 계정은 마이그레이션이 `now()`로 채웠다**(사용자 결정 "기존 사용자는 영향 없게"). 그 값은 동의를 받은 때가 아니라 **간주한 때**다 — 마이그레이션 주석에 적어 두었다. 새 가입은 트리거가 `(id)`만 넣어 null에서 시작한다. 트리거는 건드리지 않았다(결정: 두 줄 유지).
- **판정은 두 입구에 하나씩이다.** API는 `withAuth`, 웹은 `requireConsentedUser()`. `(app)`의 화면·Server Action은 전부 후자를 부르고, `requireUser()`를 직접 부르는 곳은 동의를 받는 자리(`/consent`·`acceptConsent`)와 동의와 무관한 자리(비밀번호 재설정)뿐이다.
- **API 예외는 두 경로, 옵션으로 연다**(`{ requireConsent: false }`). `web-session`까지 막으면 앱이 동의 화면에 닿을 길이 없고, `/me`에 섞으면 앱이 "토큰이 죽었다"와 "동의가 남았다"를 가르지 못한다.
- **동의 조회는 `getUser`와 병렬이다.** 요청자 토큰으로 RLS 아래에서 읽으니 `sub`를 기다릴 필요가 없다. 토큰이 무효면 이 조회는 행 없이 끝나고 버려진다.
- **403이다.** 결정 9의 "남의 자원은 404"는 존재를 숨기기 위한 것인데, 여기는 숨길 것이 없고 앱이 `401`(갱신·로그아웃)과 확실히 갈라야 한다.
- **비동의는 로그아웃이다**(사용자 결정 — 즉시 삭제는 과하다). `signOut()`을 그대로 써서 `/login?signedOut=1`에 도착하고, 앱 웹뷰라면 앱도 토큰을 버린다(결정 18).
- **방침 본문은 `app/privacy/page.tsx`가 정본이다.** 보호책임자의 초안(PDF)에서 실제 동작과 어긋난 여섯 곳을 고쳐 올렸다(ROADMAP HF-06). 사실(수집 항목·위탁처·보관 방식)이 바뀌면 이 페이지도 함께 고치고, 문장은 보호책임자 확인을 받는다.

## 인프라

- Supabase 프로젝트 **dochi** — ref `etxzzpzcsojewbwtamhz` · org `Noti` · region `ap-northeast-2` · Postgres 17 · [대시보드](https://supabase.com/dashboard/project/etxzzpzcsojewbwtamhz). 이미 link 되어 있다.
- Vercel 프로젝트 **dochi** — scope `lianists-projects` · 함수 리전 `icn1` · production <https://dochi-six.vercel.app>. 배포는 `vercel --prod`(L-P0-14에서 CLI로 생성·연결했다). **Git 연동은 없다** — `main` 푸시는 배포하지 않는다(GitHub 배포 기록 0건으로 확인, 2026-09-25). "먼저 알리고 배포한다" 같은 순서가 걸린 변경은 커밋·푸시까지 해 두고 배포만 미룰 수 있다. 환경변수 넷은 Production 스코프에 들어 있다.
- 로컬 스택(`supabase start`)은 Docker Desktop이 켜져 있어야 한다.
- 환경변수 목록은 `.env.example`. `.env.local`은 커밋하지 않는다.
