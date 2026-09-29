import { isUuid } from "@/lib/api/input";
import { listJobLogs, toJobLogPayload } from "@/lib/api/job-logs";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireConsentedUser, userTimeZone } from "@/lib/supabase/session";

import { AppShell } from "../shell";

import { HistoryList } from "./ui";

export const metadata = { title: "히스토리 · Tide" };

/** 배열로 실려 온 값은 없는 것으로 본다 — 주소창은 사람이 치는 자리라 400을 내지 않는다. */
function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 히스토리 — `HIST-1`의 화면 쪽. 에이전트가 무슨 일을 했는지를 최신순으로 읽는다.
 *
 * **API와 같은 함수를 부른다**(`listJobLogs` + `toJobLogPayload`). 화면이 자기 쿼리를 따로 쓰면
 * 정렬·100건 컷·계측 칸 비노출이 두 벌이 되고, 앱이 보는 것과 웹이 보는 것이 언젠가 갈린다
 * (`API-5`, `docs/03-Architecture.md` §설계 결정 24).
 *
 * **`?log=<uuid>` 딥링크** — 앱 알림의 본문 클릭이 여는 자리다(`NTF-4`). 대시보드의 `?task=`와
 * 같은 태도로, 없거나 남의 것이거나 UUID가 아니면 **셋이 같은 자리로 합류**해 목록만 그린다.
 * 여기서는 따로 분기할 것이 없다 — RLS가 남의 로그를 애초에 주지 않으므로 어느 경우든 목록에서
 * 짚이는 항목이 없어진다. 존재 여부가 화면 차이로 새지 않는다.
 *
 * 되돌리기 거절은 `?error=<사유>`로 돌아온다(`L-P1-04`). 사유 문장은 `lib/api/job-logs.ts`의 표가
 * 붙이고, 함께 실려 온 `?log=`이 그 문장을 **거절된 항목 안에** 앉힌다.
 *
 * `"use client"`가 없다. 실시간 반영은 대시보드의 몫이고(`DASH-5`는 태스크 목록에 걸린 요구사항),
 * 히스토리는 지나간 기록을 읽는 자리라 스스로 갱신할 이유가 없다.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ log?: string | string[]; error?: string | string[] }>;
}) {
  const user = await requireConsentedUser();
  const supabase = await createServerSupabase();
  const params = await searchParams;

  const [logs, timeZone] = await Promise.all([
    listJobLogs(supabase),
    userTimeZone(supabase, user.id),
  ]);
  if (logs.error) throw logs.error;

  // 한 번만 잰다. 항목마다 `new Date()`를 부르면 해 바뀜 경계에서 한 화면 안의 연도 표시가 갈린다.
  const now = new Date();

  return (
    <AppShell current="history" email={user.email} title="히스토리">
      <HistoryList
        logs={logs.data.map(toJobLogPayload)}
        timeZone={timeZone}
        now={now}
        openLogId={isUuid(params.log) ? params.log : null}
        error={first(params.error)}
      />
    </AppShell>
  );
}
