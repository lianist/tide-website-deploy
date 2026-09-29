-- L-P0-08 · 마감에 시각이 있는지 — 날짜만 있는 마감('9/21까지')과 시각까지 있는 마감('내일 8:30')을 구분한다.
--
-- due_at 하나로는 둘을 가를 수 없다. 날짜만 있는 마감은 due_at에 **사용자 시간대 기준 그날 23:59:59**를
-- 넣고 due_has_time = false로 둔다. 자정(00:00)이 아니라 하루의 끝인 이유: 마감은 "언제까지"이고,
-- 자정으로 두면 당일 00:01부터 '마감 지남'으로 판정되어 DASH-1 강조가 틀어진다. 정렬도 그대로 맞는다.
-- 근거는 03-Architecture.md §설계 결정 14.

alter table public.tasks
  add column due_has_time boolean not null default false,
  -- 마감이 없는데 시각이 있다고 적힐 수는 없다.
  add constraint tasks_due_has_time_requires_due_at check (due_at is not null or not due_has_time);

-- 기존 행은 전부 API로 완전한 타임스탬프를 받아 만든 것이므로 시각이 있는 마감이다.
update public.tasks set due_has_time = true where due_at is not null;

-- 인자가 늘면 시그니처가 바뀐다. create or replace로는 옛 함수가 오버로드로 남아 호출이 모호해지므로
-- 지우고 다시 만든다. 본문은 20260922022203_task_write_functions.sql과 같고 p_due_has_time만 더했다.
drop function public.create_task(text, text, timestamptz, uuid[], public.source_kind, text, uuid);

create function public.create_task(
  p_title text,
  p_description text default null,
  p_due_at timestamptz default null,
  p_tag_ids uuid[] default '{}',
  p_source public.source_kind default 'manual',
  p_rationale text default null,
  p_job_log_id uuid default null,
  p_due_has_time boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.tasks (user_id, title, description, due_at, due_has_time, source, rationale, job_log_id)
  values (auth.uid(), p_title, p_description, p_due_at, p_due_has_time, p_source, p_rationale, p_job_log_id)
  returning id into v_id;

  perform public.set_task_tags(v_id, p_tag_ids);
  return v_id;
end;
$$;

revoke execute on function public.create_task(text, text, timestamptz, uuid[], public.source_kind, text, uuid, boolean) from public, anon;
grant execute on function public.create_task(text, text, timestamptz, uuid[], public.source_kind, text, uuid, boolean) to authenticated;
