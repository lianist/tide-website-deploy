-- L-P1-05 · 태그 병합 — 연결 옮기기와 출발 태그 지우기를 한 트랜잭션으로 한다(DASH-6·API-6).
--
-- supabase-js에는 트랜잭션이 없다. "연결 옮기기 → 출발 태그 지우기"를 두 요청으로 보내면 둘째가
-- 실패했을 때 태그가 둘 다 남고 태스크에는 양쪽이 달린다. 함수 본문은 한 트랜잭션이다
-- (03-Architecture.md §설계 결정 13).
--
-- 판정 넷이 전부 delete 한 문장의 WHERE에 있다 — 출발이 보이는가(없거나 남의 것이면 0행), 자기
-- 자신이 아닌가, 출발이 '미분류'가 아닌가, 도착이 보이는가. 먼저 읽고 판단하면 읽기와 쓰기 사이에
-- 틈이 생긴다(revert_job_log와 같은 태도 — §설계 결정 25). 0행일 때에만 한 번 더 읽어 "왜"를 붙인다.
--
-- ⚠️ 옮길 태스크를 지우기 **전에** 배열에 담는다. task_tags의 복합 FK가 on delete cascade이고
--    RI 액션은 그 DELETE 문장이 끝날 때 발화하므로, 출발 태그를 지운 뒤에는 무엇을 옮겨야 했는지
--    알 수 없다. 배열은 plpgsql 로컬이라 영향을 받지 않는다.
--    순서를 뒤집어 "옮기기 먼저 → 지우기 나중"으로 쓰면, 지우기가 0행일 때 이미 붙인 도착 태그가
--    남는다. 되돌리려면 raise exception이 필요한데 저장소에 그 패턴이 0건이다.
--
-- ⚠️ returns table의 칸 이름(id·name·created_at)은 본문에서 **plpgsql 변수**가 된다. 테이블 칸을
--    수식어 없이 적으면 42702(ambiguous)로 터지므로 본문의 모든 칸이 별칭으로 한정되어 있다.
--    이름을 tag_id 따위로 바꾸지 않은 것은 응답이 lib/api/tags.ts의 toTagPayload를 그대로 지나게
--    하려는 것이다. revert_job_log가 이 함정을 안 밟은 것은 OUT 이름이 어느 칸과도 안 겹쳤기 때문이다.
--
-- ⚠️ '미분류' 문자열이 SQL에 박혀 있다(사용자 결정 2026-09-24). 병합은 rpc 한 번이라 핸들러에서
--    .neq()를 쓰기에 실을 자리가 없고, 라우트에서 먼저 읽어 막으면 §설계 결정 13이 없앤 그 틈이
--    되살아난다. 인자(p_protected_name)로 받지 않는 것은 authenticated 누구나 rpc를 직접 불러
--    보호를 끌 수 있기 때문이다. 트리거를 피한 이유(계정 삭제의 CASCADE까지 막힌다)는 함수 WHERE에
--    해당하지 않는다 — CASCADE는 이 함수를 지나지 않는다.
--    같은 문자열이 …_signup_bootstrap.sql과 lib/api/tags.ts의 UNCATEGORIZED에도 있고, 셋이 갈라지면
--    e2e/tags.spec.ts의 "'미분류' 출발 → 409"가 즉시 빨간불이 된다.
--    **보호는 출발에만 건다.** 출발은 병합으로 사라져 AGT-5의 전제가 무너지지만, 도착이 '미분류'인
--    병합은 태그를 하나도 없애지 않는다 — 오히려 "잘못 만든 태그를 미분류로 되돌린다"는 정상 동선이다.
--
-- security invoker(기본값)다. 요청자 권한으로 돌아 RLS가 그대로 걸린다 — 남의 태그는 0행이 되어
-- 자연히 404로 합류하고, 남의 '미분류'도 보호가 아니라 404가 된다(그 id가 실재한다는 것을 흘리지
-- 않는다). 소유권을 비교하는 코드가 없다. 도착의 exists가 RLS 아래에서 참이었다는 것은 곧 그
-- user_id가 auth.uid()라는 뜻이라 아래 insert의 복합 FK도 자연히 통과한다.
-- set_updated_at()과 같은 이유로 search_path를 비운다. 그래서 이름은 전부 스키마 한정되어 있다.
--
-- 결과는 행 모양으로 구분한다 — 저장소에 raise exception이 0건이고, 예외로 나르면 호출부가 errcode
-- 문자열에 묶인다. blocked_reason에는 계약의 에러 코드를 그대로 넣어(job_logs.failure_reason의
-- 선례) TS 쪽에 사유→코드 변환표가 하나 줄어든다.
create function public.merge_tags(p_source_id uuid, p_target_id uuid)
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  blocked_reason text
)
language plpgsql
set search_path = ''
as $$
declare
  v_task_ids uuid[];
begin
  -- 옮길 태스크. RLS가 남의 연결을 빼 주므로 여기 담긴 것은 전부 내 태스크다 — 그래서 아래
  -- insert의 복합 FK (task_id, user_id) → tasks(id, user_id)가 통과한다.
  -- task_tags_tag_id_idx가 받쳐 준다.
  select coalesce(array_agg(tt.task_id), '{}'::uuid[])
    into v_task_ids
    from public.task_tags tt
   where tt.tag_id = p_source_id;

  -- 판정 전부가 이 WHERE에 있다. 지워졌다면 넷 다 참이었던 것이다.
  -- 같은 id 둘은 lib/api/tags.ts가 400으로 먼저 거르지만, 함수만 직접 불러도 모순된 상태가
  -- 생기지 않게 여기서도 막는다 — 막지 않으면 방금 지운 태그로 연결을 옮기려다 23503이 된다.
  delete from public.tags s
   where s.id = p_source_id
     and s.id <> p_target_id
     and s.name <> '미분류'
     and exists (select 1 from public.tags t where t.id = p_target_id);

  if not found then
    -- 이제서야 한 번 더 읽어 "왜"를 붙인다. 출발 태그가 **보이고** 그 이름이 '미분류'일 때만
    -- 보호이고, 나머지(없는 출발·남의 출발·없는 도착·남의 도착·자기 자신)는 전부 합류한다.
    return query
      select null::uuid, null::text, null::timestamptz,
             case
               when exists (
                 select 1 from public.tags s
                  where s.id = p_source_id and s.name = '미분류'
               ) then 'TAG_PROTECTED'
               else 'TAG_NOT_FOUND'
             end::text;
    return;
  end if;

  -- 이미 도착 태그가 달려 있던 태스크는 PK(task_id, tag_id)에 걸려 조용히 넘어간다 — 한 번만
  -- 남는다. user_id는 소유권 비교가 아니라 "내 것으로 만든다"는 선언이고, 복합 FK가 세 값이 한
  -- 사용자로 일치하는지 검사한다(set_task_tags와 같은 자리·같은 이유).
  -- 위 select와 이 insert 사이에 다른 트랜잭션이 그 태스크를 지우면 23503으로 터진다. 본문이 한
  -- 트랜잭션이라 아무것도 쓰이지 않은 채 500이 나간다 — 잘못된 200이 아니므로 잠그지 않는다.
  insert into public.task_tags (task_id, tag_id, user_id)
  select task_id, p_target_id, auth.uid()
    from unnest(v_task_ids) as task_id
  on conflict do nothing;

  -- 남은 도착 태그 한 건. 병합은 이 행을 만들지도 고치지도 않으므로 created_at은 그대로다.
  return query
    select t.id, t.name, t.created_at, null::text
      from public.tags t
     where t.id = p_target_id;
end;
$$;

-- 함수는 기본으로 public에 실행 권한이 열린다. 익명 역할은 RLS에서 어차피 막히지만 입구부터 닫는다.
revoke execute on function public.merge_tags(uuid, uuid) from public, anon;
grant execute on function public.merge_tags(uuid, uuid) to authenticated;
