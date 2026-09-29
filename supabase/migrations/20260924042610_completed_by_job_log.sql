-- L-P1-01 · 되돌리기 토대 — 완료 캡처가 무엇을 닫았고 왜 닫았는지를 남긴다.
--
-- P0에서는 둘 다 일부러 비워 두었다(03-Architecture.md §설계 결정 16). 되돌리기(HIST-3·HIST-4)가
-- 그 연결을 필요로 하는데 P1이라 우선순위 격리에 걸렸고, 완료 근거를 둘 칸이 어디에도 없었다.
-- 이 루프가 둘을 연다.
--
-- 연결 칸의 방향을 tasks 쪽으로 잡았다. job_logs.completed_task_id가 아니다. 캡처가 태스크 X를
-- 닫고(로그 A) → 사용자가 되돌리고 → 다른 캡처가 X를 다시 닫으면(로그 B), job_logs 쪽에 두었을 때
-- 로그 A의 되돌리기가 B의 결과를 지운다. tasks 쪽이면 B가 칸을 덮어썼으므로 A의 되돌리기가 0행을
-- 만나 자연히 거부된다 — 추가 상태가 필요 없다. 덤으로 생성(tasks.job_log_id)과 완료가 둘 다
-- tasks에서 역조인하는 한 방향이 된다. 대가는 그 시나리오에서 로그 A의 '관련 태스크' 표시가 비는
-- 것인데, 데이터 손상보다 표시 공백을 택했다.

alter table public.tasks
  -- 이 태스크를 닫은 완료 캡처의 작업 로그. 사용자가 직접 닫았으면 비어 있다.
  -- job_log_id와 같은 이유로 cascade가 아니라 set null이다 — 로그가 지워져도 태스크는 남아야 한다.
  add column completed_by_job_log_id uuid,
  add constraint tasks_completed_by_job_log_id_fkey
    foreign key (completed_by_job_log_id) references public.job_logs (id) on delete set null;

-- "completed_by_job_log_id가 있으면 status = 'done'"을 CHECK로 걸지 않는다. 되돌리기(HIST-3)가
-- 태스크를 todo로 되돌리면서 연결은 남겨 두므로(되돌림 플래그를 따로 두지 않는 설계) 그 조건이 깨진다.

alter table public.job_logs
  -- 완료 근거 한 문장. 완료 캡처에서만 찬다 — 생성의 근거는 태스크마다 달라 이미 tasks.rationale에
  -- 있고, 로그 수준의 근거라는 것이 생성에는 없다. 같은 것을 두 곳에 적지 않는다.
  add column rationale text;

-- L-P1-02의 revert_job_log가 이 칸을 WHERE에 걸고 지운다. 완료 캡처로 닫힌 태스크는 전체의 일부라
-- 부분 인덱스가 작게 유지된다.
--
-- 짝인 job_log_id에는 인덱스가 없다 — 비대칭이지만 그대로 둔다. RLS가 모든 tasks 조회에
-- user_id = auth.uid()를 붙이므로 생성 로그의 역조인은 기존 tasks_user_id_status_due_at_idx
-- (user_id 선두)로 그 사용자 범위만 훑는다. 전역 스캔이 아니다.
create index tasks_completed_by_job_log_id_idx
  on public.tasks (completed_by_job_log_id)
  where completed_by_job_log_id is not null;
