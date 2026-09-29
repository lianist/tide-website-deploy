-- L-P0-02 · 초기 스키마 — profiles · tags · job_logs · tasks · task_tags
--
-- 이 파일이 DB 스키마의 SSOT다(03-Architecture.md §경계 3). 대시보드에서 손으로 고치지 않는다.
--
-- 비자명한 선택 세 가지 (근거는 03-Architecture.md §설계 결정 6~8):
--   1. text + CHECK 대신 enum  — 생성된 TS 타입이 리터럴 유니온이 되어 "상태는 todo·done 둘뿐"이라는
--      제품 규칙이 컴파일 타임에 보인다.
--   2. task_tags가 user_id를 들고 있다 — 모든 테이블의 RLS 정책을 `user_id = auth.uid()` 한 줄로 통일한다.
--      복합 FK가 이 값이 tasks·tags와 어긋나지 못하게 막는다.
--   3. 생성 순서는 profiles → tags → job_logs → tasks → task_tags. tasks가 job_logs를 참조하므로
--      job_logs가 먼저다.
--
-- 회원 탈퇴(SET-1)는 auth.users 한 행을 지우는 것으로 끝나야 한다. 그래서 user_id는 전부
-- auth.users(id) ON DELETE CASCADE를 타고, task_tags는 tasks·tags를 타고 따라 지워진다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 열거형
-- ─────────────────────────────────────────────────────────────────────────────

-- 상태는 둘뿐이다(00-Product.md §결정 기록 1). 늘리는 순간 입력 비용이 되살아난다.
create type public.task_status as enum ('todo', 'done');

-- 소스 = 변동이 어디서 비롯됐는가(01-Glossary.md SOURCE).
--   tasks.source    — 생성 경로. capture_create · mail · manual 중 하나. (완료 캡처는 태스크를 만들지 않는다)
--   job_logs.source — 처리한 입력. capture_create · capture_complete · mail 중 하나. (manual은 에이전트 작업이 아니다)
-- 한 타입을 공유하는 이유: 같은 것을 두 이름으로 부르지 않는다.
create type public.source_kind as enum ('capture_create', 'capture_complete', 'mail', 'manual');

-- 작업 로그 한 건의 결말. API-3 응답의 `outcome`과 같은 값을 쓴다.
create type public.job_outcome as enum ('created', 'completed', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — auth.users의 1:1 확장
-- ─────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- AGT-4의 상대 날짜 환산 기준. 앱이 캡처마다 timezone을 보내지만(API-3),
  -- 메일 소스(P2)에는 보낼 앱이 없으므로 계정에도 둔다.
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- tags
-- ─────────────────────────────────────────────────────────────────────────────

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  -- 같은 사용자가 같은 이름의 태그를 두 번 만들지 못한다. AGT-5의 "기존 태그 우선 배정"이
  -- 기댈 수 있는 유일성이고, DASH-6 태그 병합의 종료 조건이기도 하다.
  constraint tags_user_id_name_key unique (user_id, name),
  -- task_tags의 복합 FK가 참조한다. 아래 task_tags 주석 참고.
  constraint tags_id_user_id_key unique (id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- job_logs — 에이전트가 입력 한 건을 처리한 기록 (AGT-8)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.job_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source public.source_kind not null,
  outcome public.job_outcome not null,
  -- 실패 시 04-API-Contract.md의 에러 코드(NO_TASK_TO_CREATE · AGENT_TIMEOUT …)를 그대로 넣는다.
  failure_reason text,
  -- AGT-8: 실패한 경우에도 캡처 내용을 한 줄로 요약해 남긴다.
  -- 캡처 원본을 저장하지 않으므로(AGT-10) 이 한 줄이 히스토리에 남는 전부다.
  capture_summary text,
  -- LLM 계측(03-Architecture.md §설계 결정 4). 어댑터가 호출마다 채운다.
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- HIST-1 작업 로그 목록은 최신순이다.
create index job_logs_user_id_created_at_idx on public.job_logs (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- AGT-1: 제목 외에는 전부 비어 있을 수 있다. 에이전트는 추측하지 않는다(AGT-4).
  title text not null,
  description text,
  due_at timestamptz,
  status public.task_status not null default 'todo',
  -- 근거(RATIONALE) — 에이전트가 왜 이렇게 만들었는지 한 문장. DASH-3 상세 패널 필수 항목.
  rationale text,
  -- 생성 경로 — DASH-3 상세 패널 필수 항목.
  source public.source_kind not null,
  -- 이 태스크를 만든 작업 로그. 직접 생성(manual)이면 비어 있다.
  -- 로그가 지워져도 태스크는 남아야 하므로 cascade가 아니라 set null이다.
  job_log_id uuid references public.job_logs (id) on delete set null,
  created_at timestamptz not null default now(),
  -- HIST-4의 되돌리기 가능 여부 판정("사용자가 그 사이 직접 수정함")이 이 값을 읽는다.
  -- 아래 트리거가 유지한다 — 애플리케이션 코드에 맡기면 경로가 늘 때마다 새는 구멍이 된다.
  updated_at timestamptz not null default now(),
  constraint tasks_id_user_id_key unique (id, user_id)
);

-- DASH-1의 목록 규칙: 미완료/완료를 나누고 각각 마감 임박 순, 마감일 없는 것은 끝.
create index tasks_user_id_status_due_at_idx
  on public.tasks (user_id, status, due_at asc nulls last);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- search_path를 비워 스키마 하이재킹을 막는다(Supabase 데이터베이스 린터 권고).
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- task_tags — 태스크 ↔ 태그 다대다
-- ─────────────────────────────────────────────────────────────────────────────

-- user_id를 비정규화해 들고 있다. 이유 둘:
--   1. RLS 정책이 다른 테이블과 같은 한 줄(`user_id = auth.uid()`)이 된다. 조인 서브쿼리를
--      정책에 넣으면 행마다 tasks를 다시 읽는다.
--   2. 복합 FK가 "남의 태스크에 내 태그 달기"를 스키마 차원에서 불가능하게 만든다.
--      task_id·tag_id·user_id 세 값이 한 사용자로 일치하지 않으면 삽입 자체가 거부된다.
-- 비정규화의 대가인 값 어긋남은 그 복합 FK가 막으므로 실제로 치르지 않는다.
create table public.task_tags (
  task_id uuid not null,
  tag_id uuid not null,
  user_id uuid not null,
  primary key (task_id, tag_id),
  constraint task_tags_task_fkey foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint task_tags_tag_fkey foreign key (tag_id, user_id)
    references public.tags (id, user_id) on delete cascade
);

-- DASH-2 태그 필터: 태그 하나로 태스크를 거른다.
create index task_tags_tag_id_idx on public.task_tags (tag_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — 모든 테이블, 단일 축
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 정책은 테이블마다 하나다. 명령별로 쪼개면 네 곳이 갈라질 수 있고, 여기서 갈라지면
-- 남의 데이터가 보인다. `to authenticated`로 익명 역할은 정책 평가 전에 잘라낸다.
--
-- with check까지 같은 조건을 거는 이유: using만 걸면 "남의 user_id로 행을 만들기"가 열린다.

alter table public.profiles enable row level security;
alter table public.tags enable row level security;
alter table public.job_logs enable row level security;
alter table public.tasks enable row level security;
alter table public.task_tags enable row level security;

-- profiles만 축이 id다 — auth.users와 1:1이라 별도 user_id를 두지 않았다.
create policy "본인 프로필만" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "본인 태그만" on public.tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "본인 작업 로그만" on public.job_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "본인 태스크만" on public.tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "본인 태스크-태그 연결만" on public.task_tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
