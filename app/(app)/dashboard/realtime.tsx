"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * 실시간 반영(`DASH-5`) — **저장소의 유일한 `"use client"`다.**
 *
 * 목록을 브라우저로 들고 오지 않는다. 여기가 하는 일은 "내 태스크가 바뀌었다"를 듣고 서버에 다시
 * 그려 달라고 하는 것뿐이고, 정렬(`DASH-1` 3단)·태그 조인·태그 필터 판정·시간대 기준 마감 강조는
 * 전부 `lib/api/tasks.ts`와 `app/(app)/dashboard/page.tsx` 한 자리에 남는다. Realtime의
 * `postgres_changes` 페이로드는 `tasks` 행(스네이크케이스)만 주고 `task_tags(tags(...))` 조인이
 * 없어서, 그것으로 목록을 만들려면 그 규칙들을 브라우저에 한 벌 더 복제해야 한다.
 * 근거는 `docs/03-Architecture.md` §설계 결정 21.
 *
 * ⚠️ `next/navigation`의 `refresh()`다. `next/cache`의 `refresh()`는 Server Action 전용이다.
 */

/**
 * 캡처 한 장이 태스크 여러 건을 만든다(`lib/agent/create.ts`가 한 건씩 `create_task`를 부른다).
 * 접지 않으면 INSERT 한 건마다 서버를 다시 부르며 중간 상태(1건 → 2건 → …)를 차례로 그린다.
 * 트레일링이라 이벤트가 몰아쳐도 조용해진 뒤 한 번만 나간다.
 */
const COALESCE_MS = 200;

export function TaskRealtime({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, COALESCE_MS);
    };

    // RLS가 이미 남의 행을 막지만 필터도 함께 건다 — 서버가 보내지도 않게 해서 "본인 행으로
    // 제한됨"을 구독 자체에 적어 둔다.
    const filter = `user_id=eq.${userId}`;

    const start = async () => {
      // 🔴 **세션을 먼저 기다린다.** 클라이언트를 만든 직후에는 쿠키를 아직 읽지 않아 토큰이
      // 비어 있고, 그대로 구독하면 join이 **익명으로 나가 RLS가 모든 행을 막는다** — 채널은
      // `SUBSCRIBED`가 되는데 이벤트만 영영 오지 않는 모양이라 원인을 찾기 어렵다(실측).
      // `getClaims()`는 세션 복원까지 기다려 주고, 토큰 검증까지 하므로 `getSession()`보다 낫다.
      await supabase.auth.getClaims();
      if (cancelled) return;

      channel = supabase
        // 🔑 **topic이 마운트마다 달라야 한다.** `RealtimeClient.channel(topic)`은 같은 topic이
        // 이미 있으면 그 객체를 그대로 돌려주고, `subscribe()`는 채널이 닫혀 있을 때만 join을
        // 보낸다. App Router는 StrictMode가 기본이라 mount → cleanup → mount가 도는데, topic이
        // 고정이면 두 번째 mount가 아직 닫히는 중인 첫 채널을 받아 **아무것도 구독하지 않은 채
        // 끝난다**(dev에서만 죽고 prod에서는 사는 모양이 된다).
        .channel(`dashboard-tasks:${userId}:${crypto.randomUUID()}`)
        // 🔴 `event: "*"`를 쓰지 않는다. DELETE에는 RLS가 적용되지 않고(지워진 행의 접근 권한을
        // Postgres가 확인할 방법이 없다), replica identity가 기본값이면 `user_id` 필터마저
        // 무시되어 **남의 태스크 id가 이 브라우저로 들어온다.** 듣지 않는 것이 거르는 것보다
        // 확실하다.
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "tasks", filter },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "tasks", filter },
          scheduleRefresh,
        )
        .subscribe((status) => {
          // **구독이 설 때마다 한 번 따라잡는다 — 첫 구독도 예외가 아니다.**
          //
          // Realtime은 끊긴 동안의 변경을 재생해 주지 않는다(at-most-once). 재연결이야 당연하고,
          // **첫 구독에도 틈이 있다**: 서버가 화면을 그린 시각과 이 채널이 서는 시각 사이(세션
          // 복원 왕복만큼)에 들어온 변경은 아무도 보지 못한다. 처음엔 "방금 그린 화면이니
          // 낭비"라고 보고 건너뛰었는데, 그 틈으로 실제 태스크가 새는 것을 테스트가 잡았다.
          // 대가는 페이지 로드마다 RSC 왕복 한 번이다.
          if (status === "SUBSCRIBED") scheduleRefresh();
        });
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // `removeAllChannels()`를 쓰지 않는다 — 나중에 다른 구독이 생기면 남의 것까지 끊는다.
      if (channel) void supabase.removeChannel(channel);
    };
    // `userId`는 세션 동안 고정이고 `router`는 안정적이라, `router.refresh()`로 페이지가 다시
    // 그려져도 이 효과는 다시 돌지 않는다 — 재구독이 일어나지 않는다.
  }, [userId, router]);

  return null;
}
