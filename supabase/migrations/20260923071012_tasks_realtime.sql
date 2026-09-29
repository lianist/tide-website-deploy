-- L-P0-13 · 실시간 반영(DASH-5) — tasks를 Realtime publication에 올린다.
--
-- Realtime은 논리 복제 슬롯이 디코딩한 변경을 흘려보낸다. publication에 없는 테이블의 변경은
-- 애초에 디코딩 대상이 아니라 누구도 구독할 수 없다. 대시보드가 듣는 것은 tasks 하나뿐이다.
-- 전체 설계는 03-Architecture.md §설계 결정 21.

alter publication supabase_realtime add table public.tasks;

-- replica identity는 DEFAULT(기본 키만) 그대로 둔다. full로 올려서 얻는 것은 DELETE 이벤트를
-- user_id로 거를 수 있게 되는 것뿐인데, 클라이언트는 DELETE를 아예 구독하지 않는다 — DELETE에는
-- RLS가 적용되지 않아(지워진 행의 접근 권한을 Postgres가 확인할 방법이 없다) 듣는 순간 남의
-- 태스크 id가 흘러든다. 대신 UPDATE마다 옛 행 전체가 WAL에 실리는 비용을 치르게 된다.
--
-- 포기하는 것: 다른 탭·앱에서 지운 태스크가 이 탭에서 즉시 사라지지 않는다. 에이전트는 삭제하지
-- 않고(제품 규칙 — 생성과 완료만), 웹의 삭제는 그 탭의 Server Action이 이미 다시 그린다.

-- task_tags는 올리지 않는다. 태그만 바꾸는 저장은 tasks 행을 건드리지 않아 다른 탭에 즉시 반영되지
-- 않지만, DASH-5가 요구하는 생성·완료는 둘 다 tasks 행을 쓴다.
