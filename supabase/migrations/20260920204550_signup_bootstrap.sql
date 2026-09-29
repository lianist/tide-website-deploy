-- L-P0-03 · 가입 부트스트랩 — 계정이 생기는 순간 profiles 행과 '미분류' 태그를 함께 만든다.
--
-- 애플리케이션 코드가 아니라 트리거인 이유: 가입 경로가 넷인데 그중 둘이 우리 코드를 지나지 않는다.
--   1. 웹 이메일 가입          → app/(auth)/actions.ts
--   2. Google 최초 로그인      → Supabase가 직접 만든다
--   3. admin.createUser()      → e2e 헬퍼가 쓴다 (테스트 계정 전부)
--   4. 앱 경유 가입 (L-P0-04)  → 아직 없다
-- 한 경로라도 빠지면 AGT-5의 "판단이 어려우면 '미분류'에 넣는다"가 태그 없는 계정에서 무너진다.
-- 트리거는 auth.users 삽입과 같은 트랜잭션에서 돌아 네 경로를 한 번에 덮는다.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
-- set_updated_at()과 달리 security definer다. 이 트리거는 auth 서버 역할(supabase_auth_admin)로
-- 실행되는데 그 역할에는 public 테이블 권한이 없고 RLS도 걸려 있다. 소유자 권한으로 실행해야
-- 두 행을 넣을 수 있다.
security definer
-- set_updated_at()과 같은 이유로 search_path를 비운다(스키마 하이재킹 방지, Supabase 린터 권고).
-- 그래서 아래 이름은 전부 스키마 한정되어 있다.
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.tags (user_id, name) values (new.id, '미분류');
  return new;
end;
$$;

-- on conflict 방어절을 두지 않는다. after insert on auth.users는 사용자당 정확히 한 번 돌고,
-- 이미 가입한 주소로 Google 로그인을 해도 Supabase는 identity를 기존 행에 연결할 뿐 auth.users에
-- 새 행을 만들지 않는다. 충돌 경로가 없는 곳에 방어 코드를 두지 않는다.
--
-- 대신 대가는 알고 받는다 — 이 함수가 에러를 내면 가입 트랜잭션 전체가 롤백되어 사용자에게는
-- "Database error saving new user"가 보인다. 그래서 함수를 두 줄로 유지한다.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 백필 — 트리거는 소급되지 않는다. 이 마이그레이션 이전에 만들어진 계정(개발자 본인 계정,
-- 중단된 e2e 실행이 남긴 테스트 계정)에도 AGT-5의 전제가 서 있어야 한다. 둘 다 멱등이다.
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

insert into public.tags (user_id, name)
select u.id, '미분류'
from auth.users u
left join public.tags t on t.user_id = u.id and t.name = '미분류'
where t.id is null;
