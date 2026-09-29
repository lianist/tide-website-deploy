import Link from "next/link";

import { failureSentence, NO_SUMMARY } from "@/app/(app)/history/ui";
import { Icon } from "@/components/icons";
import { Button, buttonClass } from "@/components/ui";
import type { JobLogPayload } from "@/lib/api/job-logs";
import { formatMoment } from "@/lib/time";

import { skipLog } from "./actions";
import { dashboardUrl } from "./url";

/**
 * '확인 필요'(`DASH-11`, `L-P1-12`) — 생성이 실패한 캡처 중 사용자가 아직 처리하지 않은 것.
 *
 * **신뢰도가 낮은 항목이 아니다.** 에이전트는 여전히 되묻지 않고, 여기 오는 것은 에이전트가
 * 태스크를 **만들지 못한** 캡처뿐이다(범위는 `lib/api/job-logs.ts`의 `NEEDS_REVIEW` 한 곳).
 * 받은편지함처럼 비워지는 목록이라 버튼은 둘뿐이다 — [직접 처리]로 태스크를 저장하거나 [넘기기].
 * 둘 다 기록을 지우지 않는다. 히스토리에는 그대로 남는다.
 *
 * 항목의 재료(시각·요약·사유 문장)는 히스토리와 같다 — 같은 기록을 두 곳에서 다르게 말하면 안 된다.
 */
export function ReviewList({
  logs,
  timeZone,
  now,
}: {
  logs: JobLogPayload[];
  timeZone: string;
  now: Date;
}) {
  return (
    <section aria-label="확인 필요" className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 font-heading text-h2 text-ink">
        확인 필요
        <span className="num text-body text-ink-secondary">{logs.length}</span>
      </h2>

      {logs.length === 0 ? (
        <p className="text-body-s text-ink-secondary">
          확인할 캡처가 없습니다. 에이전트가 만들지 못한 캡처가 생기면 여기에 모입니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {logs.map((log) => (
            <li
              key={log.id}
              data-log-id={log.id}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3"
            >
              <time dateTime={log.createdAt} className="num text-body-s text-ink-secondary">
                {formatMoment(log.createdAt, timeZone, now)}
              </time>
              <p className={`text-body ${log.captureSummary ? "text-ink" : "text-ink-disabled"}`}>
                {log.captureSummary ?? NO_SUMMARY}
              </p>
              <p className="text-body-s text-error-ink">{failureSentence(log.failureReason)}</p>

              <div className="flex flex-wrap justify-end gap-2">
                {/*
                  [넘기기]가 먼저, [직접 처리]가 끝이다 — 오른쪽 끝이 앞으로 나아가는 행동이다(키트 3-2).
                  둘 다 2차다. 채움 인디고는 헤더의 [+ 새 태스크] 하나다.

                  [직접 처리]는 '확인 필요' 보기를 나른다 — 저장하면 이 목록으로 돌아와 방금 만든
                  태스크의 패널이 열리고, 항목은 빠져 있다.
                */}
                <form action={skipLog}>
                  <input type="hidden" name="id" value={log.id} />
                  <Button tone="secondary" size="sm">
                    넘기기
                  </Button>
                </form>
                <Link
                  href={dashboardUrl({ view: "review", isNew: true, from: log.id })}
                  className={buttonClass("secondary", "sm")}
                >
                  직접 처리
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * '오늘' 상단 배너 — "확인이 필요한 캡처가 N건 있어요 [보기]"(키트 목업). 0건이면 그리지 않는다.
 *
 * **흐름 안의 블록이다.** 목록 위에 겹쳐 뜨지 않으므로 z-index 체계가 여전히 필요 없다
 * (`docs/ROADMAP.md` §하지 않는 것). 배지와 같은 인디고라 **모양으로** 가른다 — 넓은 배너 + 아이콘
 * (키트 3-4: 확인 필요는 넓은 배너, '자동'은 점이 붙은 작은 배지).
 */
export function ReviewBanner({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-card border border-attention-line bg-attention-bg px-4 py-3"
    >
      <Icon name="alert" size={20} className="shrink-0 text-attention-icon" />
      <p className="min-w-0 flex-1 text-body text-attention-ink">
        확인이 필요한 캡처가 <span className="num font-semibold">{count}</span>건 있어요
      </p>
      <Link href={dashboardUrl({ view: "review" })} className={buttonClass("text", "sm")}>
        보기
      </Link>
    </div>
  );
}
