-- HF-06 · 개인정보처리방침 동의 — 동의 전에는 대시보드도 API도 쓰지 못한다.
--
-- 방침 동의와 만 14세 이상 확인을 한 화면(/consent)에서 함께 받는다. 그래서 칸도 하나다.
-- 불리언이 아니라 시각이다 — 같은 한 칸으로 "언제 동의했나"까지 담는다. null = 아직 동의하지 않음.
--
-- 새 가입은 가입 트리거(handle_new_user)가 (id)만 넣으므로 자동으로 null에서 시작한다. 트리거는
-- 건드리지 않는다.
--
-- 새 RLS 정책이 없다. 기존 "본인 프로필만"(for all)이 본인 행의 select·update를 이미 허용한다.
-- 사용자가 PostgREST로 이 칸을 직접 채울 수도 있지만, 그것도 본인의 동의라 막을 이유가 없다.

alter table public.profiles
  add column consented_at timestamptz;

-- 기존 사용자는 영향 없게 한다(사용자 결정 2026-09-27). 방침 시행 전에 가입한 계정이라 동의로
-- 간주하고 이 마이그레이션 시각을 넣는다 — 이 시각은 "동의를 받은 때"가 아니라 "간주한 때"다.
update public.profiles set consented_at = now();
