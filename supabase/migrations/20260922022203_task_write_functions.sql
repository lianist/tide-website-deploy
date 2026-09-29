-- L-P0-06 · 태스크 쓰기 함수 — 태스크와 태그 연결을 한 트랜잭션으로 쓴다.
--
-- supabase-js에는 트랜잭션이 없다. "태스크 insert → task_tags insert"를 두 요청으로 보내면 둘째가
-- 실패했을 때 태그 없는 태스크가 남는다. 함수 본문은 한 트랜잭션이다(03-Architecture.md §설계 결정 13).
--
-- 둘 다 security invoker(기본값)다. 요청자 권한으로 돌므로 RLS와 task_tags의 복합 FK가 그대로 걸린다 —
-- 남의 태그 id를 넣으면 (tag_id, 내 uid) 쌍이 tags에 없어 23503으로 거부된다. FK 검사는 RLS를 우회하므로
-- "안 보이는 태그"와 "없는 태그"가 똑같이 걸린다.
--
-- set_updated_at()과 같은 이유로 search_path를 비운다. 그래서 이름은 전부 스키마 한정되어 있다.

-- 태스크의 태그를 통째로 갈아끼운다. 태스크가 보이지 않으면(없거나 남의 것) false.
create or replace function public.set_task_tags(p_task_id uuid, p_tag_ids uuid[])
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tasks where id = p_task_id) then
    return false;
  end if;

  delete from public.task_tags where task_id = p_task_id;

  insert into public.task_tags (task_id, tag_id, user_id)
  select distinct p_task_id, tag_id, auth.uid()
  from unnest(p_tag_ids) as tag_id;

  return true;
end;
$$;

-- 태스크 하나를 태그와 함께 만든다. HTTP POST는 항상 manual로 부르고,
-- source·rationale·job_log_id는 에이전트(L-P0-08)가 같은 함수를 쓰려고 열어 둔다.
create or replace function public.create_task(
  p_title text,
  p_description text default null,
  p_due_at timestamptz default null,
  p_tag_ids uuid[] default '{}',
  p_source public.source_kind default 'manual',
  p_rationale text default null,
  p_job_log_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.tasks (user_id, title, description, due_at, source, rationale, job_log_id)
  values (auth.uid(), p_title, p_description, p_due_at, p_source, p_rationale, p_job_log_id)
  returning id into v_id;

  perform public.set_task_tags(v_id, p_tag_ids);
  return v_id;
end;
$$;

-- 함수는 기본으로 public에 실행 권한이 열린다. 익명 역할은 RLS에서 어차피 막히지만 입구부터 닫는다.
revoke execute on function public.set_task_tags(uuid, uuid[]) from public, anon;
revoke execute on function public.create_task(text, text, timestamptz, uuid[], public.source_kind, text, uuid) from public, anon;
grant execute on function public.set_task_tags(uuid, uuid[]) to authenticated;
grant execute on function public.create_task(text, text, timestamptz, uuid[], public.source_kind, text, uuid) to authenticated;
