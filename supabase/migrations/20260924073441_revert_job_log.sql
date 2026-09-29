-- L-P1-02 · 되돌리기 — 작업 로그 하나를 한 트랜잭션으로 되돌린다(HIST-3·HIST-4).
--
-- 판정을 SQL 하나로 모은다. revert_blocked_reason()이 "되돌릴 수 없는 사유 코드"(되돌릴 수 있으면
-- null)를 돌려주고, GET /api/v1/job-logs는 PostgREST 계산 컬럼으로 그 값을 읽어 revertable을
-- 만든다. TypeScript가 판정을 재계산하지 않으므로 목록의 버튼과 실제 되돌리기 결과가 갈라질 수
-- 없다 — lib/agent/complete.ts가 "판정 조건은 revert_job_log의 WHERE 하나"라고 선언해 둔 대로다.
--
-- ⚠️ 쓰기는 사유 함수를 믿지 않는다. 쓰기 문장의 WHERE가 조건 전부를 스스로 들고 있고, 0행이
-- 나왔을 때에만 사유 함수를 불러 "왜"를 붙인다 — 판정은 쓰기가, 설명은 사유 함수가 한다.
-- 사유 함수로 먼저 분기하면 검사와 쓰기 사이에 창이 생긴다.
--
-- 📌 revert_blocked_reason의 인자에는 이름이 없다. p_ 접두사 규칙의 유일한 예외이고 근거가 둘이다.
--    (1) PostgREST는 무명 인자여야 계산 컬럼으로 읽고, 동시에 RPC 엔드포인트로 노출하지 않는다.
--    (2) postgrest-js의 ComputedField 타입이 Args: { '': Row } 형태만 계산 컬럼으로 인정한다.
--
-- 📌 20260924042610_completed_by_job_log.sql의 주석은 "revert_job_log가 completed_by_job_log_id를
--    WHERE에 걸고 지운다"고 적었는데, 여기서 절반이 바뀌었다. WHERE에는 걸지만 **연결은 남긴다**
--    (사용자 결정 2026-09-24). 지우면 그 로그의 '관련 태스크' 표시가 영구히 비어 04-API-Contract.md
--    §작업 로그의 약속("되돌린 뒤에도 남는다")과 어긋난다. 대가는 ROADMAP에 알려진 한계로 적었다.
--
-- 둘 다 security invoker(기본값)다. 요청자 권한으로 돌므로 RLS가 그대로 걸리고, 남의 로그는
-- job_logs 조회가 0행이 되어 자연히 404로 합류한다 — 소유권을 비교하는 코드가 없다.
-- set_updated_at()과 같은 이유로 search_path를 비운다. 그래서 이름은 전부 스키마 한정되어 있다.

-- 계산 컬럼은 목록 100건마다 job_log_id 점조회를 한다. L-P1-01은 이 칸의 인덱스를 일부러 비워
-- 두었는데(임베딩은 IN 목록 한 번이라 사용자 범위 스캔으로 충분했다) 행마다 도는 접근 패턴이
-- 생기면서 그 전제가 깨졌다. completed_by_job_log_id와 대칭으로 부분 인덱스를 연다.
create index tasks_job_log_id_idx
  on public.tasks (job_log_id)
  where job_log_id is not null;

-- 되돌릴 수 없는 사유. 되돌릴 수 있으면 null.
--
-- language sql · stable이다 — 순수한 식이고 PostgREST가 계산 컬럼에 기대하는 형태다. 저장소의
-- 다른 함수가 전부 plpgsql인 것에서 한 발 나가는 자리이고, 근거는 이 함수만 조회 경로에서
-- 행마다 불린다는 것이다.
--
-- 갈래는 source가 아니라 outcome으로 가른다. source는 입력이 어디서 왔는지를, outcome은 DB에
-- 무엇이 쓰였는지를 말하고, 되돌리기는 쓰인 것을 되돌리는 일이다. 덕분에 source='mail'인 생성
-- 로그가 생성 갈래를 그대로 타고, source='capture_create'인데 outcome='failed'인 로그가 생성
-- 갈래로 잘못 들어가지 않는다. public/api.md가 앱에 "outcome의 값은 늘지 않는다"고 약속해 둔
-- 축이기도 하다.
--
-- TASK_MODIFIED를 완료 갈래에 걸지 않는다. 완료 캡처가 status를 쓴 것 자체가 updated_at을
-- 올리므로 완료된 태스크는 **항상** updated_at <> created_at이다. 걸면 완료 되돌리기가 100%
-- 막힌다. 완료 쪽의 HIST-4는 status='todo'와 연결 소실이 이미 전부 덮는다.
create function public.revert_blocked_reason(public.job_logs)
returns text
language sql
stable
set search_path = ''
as $$
  select case $1.outcome
    -- 실패 로그는 쓴 것이 없다. HIST-4의 세 조항 밖이지만 되돌릴 수 없는 것은 같다.
    when 'failed' then 'NOTHING_TO_REVERT'

    when 'created' then case
      -- 0건: 이미 되돌렸거나 사용자가 지웠다. 물리적으로 같은 상태라 구분하지 않는다.
      when not exists (
        select 1 from public.tasks where job_log_id = $1.id
      ) then 'TASK_GONE'
      -- 하나라도 손댔으면 전부 거부한다(all-or-nothing). 트리거가 UPDATE에만 걸려 생성 직후에는
      -- updated_at = created_at이 성립하는 것이 이 판정의 근거다.
      when exists (
        select 1 from public.tasks where job_log_id = $1.id and updated_at <> created_at
      ) then 'TASK_MODIFIED'
      else null
    end

    else case  -- 'completed'
      when exists (
        select 1 from public.tasks
        where completed_by_job_log_id = $1.id and status = 'done'
      ) then null
      -- 연결은 살아 있는데 이미 todo다 = 이미 되돌렸다(HIST-4 "이미 미완료임").
      when exists (
        select 1 from public.tasks where completed_by_job_log_id = $1.id
      ) then 'ALREADY_REVERTED'
      -- 태스크가 지워졌거나, 다른 캡처가 다시 닫아 연결이 덮였다(설계 결정 16). 둘을 구분할 수
      -- 없으므로 코드도 하나로 둔다 — 문장도 둘 다에서 참인 것만 쓴다.
      else 'TASK_GONE'
    end
  end;
$$;

-- 로그 하나를 되돌린다. 세 결과를 행 모양으로 구분한다 — 저장소에 raise exception이 0건이고,
-- 예외로 결과를 나르면 호출부가 errcode 문자열에 묶인다.
--   0행                  → 없거나 남의 로그. 라우트가 404 JOB_LOG_NOT_FOUND로 옮긴다.
--   blocked_reason 있음  → 409 REVERT_NOT_POSSIBLE. 문장은 lib/api/job-logs.ts의 표가 붙인다.
--   reverted·task_ids    → 200.
create function public.revert_job_log(p_job_log_id uuid)
returns table (
  reverted public.job_outcome,
  blocked_reason text,
  task_ids uuid[]
)
language plpgsql
set search_path = ''
as $$
declare
  v_log public.job_logs%rowtype;
  v_task_ids uuid[];
begin
  -- RLS가 남의 로그를 보여 주지 않는다. 없는 로그와 남의 로그가 여기서 같은 0행으로 합류한다.
  select * into v_log from public.job_logs where id = p_job_log_id;
  if not found then
    return;
  end if;

  if v_log.outcome = 'created' then
    -- all-or-nothing을 문장 하나의 성질로 만든다. locked는 **가져오고 잠그기만** 하고, 판정은
    -- 전부 DELETE의 WHERE에 있다. not exists 안의 조건이 행마다 달라지지 않으므로 전체가 통째로
    -- 참이거나 통째로 거짓이다 = 하나라도 수정됐으면 한 건도 지워지지 않는다.
    --
    -- for update를 CTE 안에 접어 넣은 것이 요점이다. 별도 SELECT … FOR UPDATE 문장을 앞에 두면
    -- 판정이 쓰기 밖으로 나가고, 잠그지 않으면 read committed에서 스냅샷을 찍은 뒤 커밋된
    -- 사용자 편집을 못 보고 지워 버린다 — HIST-4가 절대 하지 말라는 바로 그 일이다.
    with locked as (
      select t.id, t.created_at, t.updated_at
      from public.tasks t
      where t.job_log_id = v_log.id
      for update
    ),
    removed as (
      delete from public.tasks t
      where t.id in (select l.id from locked l)
        and not exists (select 1 from locked l where l.updated_at <> l.created_at)
      returning t.id, t.created_at
    )
    select coalesce(array_agg(id order by created_at, id), '{}'::uuid[])
      into v_task_ids from removed;

  elsif v_log.outcome = 'completed' then
    -- status = 'done'이 WHERE에 있어 재실행이 자연히 0행이 된다. 되돌림 플래그가 필요 없다.
    -- completed_by_job_log_id는 지우지 않는다 — 히스토리의 '관련 태스크'가 남아야 한다.
    with reopened as (
      update public.tasks
         set status = 'todo'
       where completed_by_job_log_id = v_log.id
         and status = 'done'
      returning id, created_at
    )
    select coalesce(array_agg(id order by created_at, id), '{}'::uuid[])
      into v_task_ids from reopened;

  else
    -- outcome = 'failed'. 쓰기를 시도하지 않고 아래 공통 경로로 떨어진다.
    v_task_ids := '{}'::uuid[];
  end if;

  if coalesce(array_length(v_task_ids, 1), 0) = 0 then
    -- 쓰기가 0행이었다. 이제서야 사유 함수를 불러 "왜"를 붙인다. coalesce의 기본값은 경합으로
    -- 사유 함수가 null을 보는 찰나를 위한 것이다 — 사유 없는 409가 나가지 않게.
    return query
      select null::public.job_outcome,
             coalesce(public.revert_blocked_reason(v_log), 'TASK_GONE'),
             null::uuid[];
    return;
  end if;

  -- outcome을 그대로 되비친다. 여기 도달했다면 'failed'일 수 없다(위에서 늘 0행이 된다).
  return query select v_log.outcome, null::text, v_task_ids;
end;
$$;

-- 함수는 기본으로 public에 실행 권한이 열린다. 익명 역할은 RLS에서 어차피 막히지만 입구부터 닫는다.
revoke execute on function public.revert_blocked_reason(public.job_logs) from public, anon;
revoke execute on function public.revert_job_log(uuid) from public, anon;
grant execute on function public.revert_blocked_reason(public.job_logs) to authenticated;
grant execute on function public.revert_job_log(uuid) to authenticated;
