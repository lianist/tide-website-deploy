-- L-P1-11 · 확인 필요 토대 (DASH-11) — 실패한 생성 캡처를 "처리함"으로 표시할 칸 하나.
--
-- '확인 필요'는 받은편지함처럼 0건이 되는 목록이다. 사용자가 [직접 처리]로 태스크를 저장하거나
-- [넘기기]를 누르면 빠진다. 불리언이 아니라 시각이다 — 같은 한 칸으로 "언제 처리했나"까지 담는다.
-- null = 아직 처리하지 않음.
--
-- 로그를 지우지 않는다. [넘기기]도 이 칸만 채우고, 히스토리(HIST-1)에는 그대로 남는다.
--
-- 새 RLS 정책이 없다. 기존 "본인 작업 로그만"(for all)이 본인 행의 update를 이미 허용하고 남의
-- 행은 0행으로 만든다 — 남의 로그를 처리하려는 시도는 오류가 아니라 아무 일도 안 일어난다.

alter table public.job_logs
  add column handled_at timestamptz;

-- '확인 필요'의 범위 — lib/api/job-logs.ts의 NEEDS_REVIEW와 같은 조건이다(사용자 결정 2026-09-25).
-- 생성 캡처의 실패 중 세 사유만 담는다.
--   · DUPLICATE_TASK는 뺀다: 같은 일의 태스크가 이미 목록에 있고, 알림이 그 제목을 이미 말했다.
--   · 완료 캡처의 실패는 뺀다: 피드백이 말한 것은 "생성 실패"다.
-- 조건을 바꾸면 이 인덱스와 NEEDS_REVIEW를 함께 고친다. 둘이 갈라지면 쿼리가 인덱스를 못 탈 뿐
-- 결과는 맞다 — 틀린 결과가 아니라 느려지는 쪽으로 망가진다.
--
-- 남은 것은 대개 한 자릿수라 부분 인덱스가 거의 비어 있다. 건수 배지(count)와 목록(최신순)이
-- 둘 다 이것 하나로 끝난다.
create index job_logs_needs_review_idx on public.job_logs (user_id, created_at desc)
  where handled_at is null
    and source = 'capture_create'
    and outcome = 'failed'
    and failure_reason in ('NO_TASK_TO_CREATE', 'AGENT_TIMEOUT', 'INTERNAL_ERROR');
