import Link from "next/link";

import { SOURCE_LABEL } from "@/app/(app)/messages";
import { Alert, Button, StatusPill, buttonClass } from "@/components/ui";
import type { JobLogPayload } from "@/lib/api/job-logs";
import { revertErrorMessage } from "@/lib/api/job-logs";
import { formatMoment } from "@/lib/time";

import { revertLog } from "./actions";

/**
 * 히스토리 목록(`HIST-1`의 화면 쪽). 전부 서버에서 그려진다.
 *
 * **마크업 계약은 `data-due`의 성공을 복제한다** — 분류는 마크업에(`data-source`·`data-outcome`·
 * `data-revertable`), 문구와 색은 자유롭게. 검증이 붙잡는 것이 "실패로 분류되었다"이지 색번호나
 * 버튼의 존재가 아니어서, 팔레트를 바꿔도 [되돌리기]가 나중에 메뉴 안으로 들어가도 검증이 산다.
 */

/**
 * DB에 **무엇이 쓰였는지**. 입력이 어디서 왔는지를 말하는 `SOURCE_LABEL`과 축이 다르다 —
 * `source="capture_create"`인데 `outcome="failed"`인 로그가 실제로 있고(캡처는 생성 모드로 왔지만
 * 만들 것이 없었다), 그때 두 라벨은 서로 다른 참을 말한다.
 */
const OUTCOME_LABEL: Record<JobLogPayload["outcome"], string> = {
  created: "생성됨",
  completed: "완료됨",
  failed: "실패",
};

/**
 * 실패 사유 코드 → 사용자가 읽을 문장.
 *
 * **앱 알림의 문구(`lib/agent/`·`lib/api/captures.ts`)를 그대로 가져오지 않는다.** 저쪽은 알림
 * 본문이라 "생성할 태스크가 없어요."처럼 말을 걸고, 여기는 지나간 기록을 훑는 자리라 도치 웹이
 * 줄곧 써 온 "~습니다"체다. 같은 사실이되 어조가 다르고, 화면이 `lib/agent/`를 import 하지
 * 않는다는 경계도 지킨다(`lib/time.ts` 머리 주석).
 */
const FAILURE_MESSAGE: Record<string, string> = {
  NO_TASK_TO_CREATE: "생성할 태스크를 찾지 못했습니다.",
  NO_TASK_TO_COMPLETE: "완료할 태스크를 찾지 못했습니다.",
  // [직접 처리]가 그대로 교정 동선이다 — "같은 일이 아니다"라고 보면 사용자가 새로 만든다.
  DUPLICATE_TASK: "이미 있는 태스크와 같은 일이라 만들지 않았습니다.",
  AGENT_TIMEOUT: "처리 시간이 초과되었습니다.",
  INTERNAL_ERROR: "처리 중 문제가 생겼습니다.",
};

/** 표에 없는 코드가 와도 빈 줄이 나가지 않게. */
const UNKNOWN_FAILURE = "처리하지 못했습니다.";

/** 실패 사유 문장 한 줄. 대시보드의 '확인 필요'(`L-P1-12`)도 같은 문장을 쓴다 — 같은 기록이다. */
export function failureSentence(code: string | null): string {
  return (code && FAILURE_MESSAGE[code]) ?? UNKNOWN_FAILURE;
}

/**
 * 요약이 없는 로그 — 타임아웃과 LLM 오류다. 요약은 LLM 출력에서만 나오고, 요약을 위해 한 번 더
 * 부르면 10초 예산을 깬다(`docs/03-Architecture.md` §설계 결정 17).
 *
 * "읽지 못했습니다"라고 쓰지 않는다. LLM이 답한 뒤 해석에 실패한 경우에도 여기로 오는데, 그때
 * 모델은 화면을 읽기는 했다. 둘 다에서 참인 문장만 쓴다 — `TASK_GONE`의 문구를 고른 것과 같은 규율.
 */
export const NO_SUMMARY = "캡처 내용이 기록되지 않았습니다.";

/** 로그가 하나도 없을 때. 대시보드의 '할 일' 빈 상태와 같은 결로 다음 행동을 알려 준다. */
export const EMPTY_HISTORY = "아직 기록이 없습니다. 앱에서 화면을 캡처하면 여기에 쌓입니다.";

/**
 * 실패한 기록을 사용자가 손으로 이어받는 자리(`HIST-2`). **소스가 목적지를 정한다.**
 *
 * - `capture_complete` → `/dashboard?view=all`. 완료할 것을 찾지 못한 캡처이므로 사용자가 골라야
 *   하고, 미완료 목록 전부가 '전체' 보기다(`L-P1-10` — 그 전에는 대시보드 기본 화면이 곧 미완료
 *   목록이라 `/dashboard`였다. 이제 기본 화면은 '오늘'이라 골라야 할 태스크가 빠질 수 있다).
 * - 그 밖 → `/dashboard?new=1&from=<logId>`. 새 태스크 패널이 열리고 서버가 그 로그의 요약을
 *   제목 칸에 채운다. **요약 문장을 URL에 싣지 않는다** — 캡처 내용이라 주소창·브라우저 히스토리에
 *   남을 자리가 아니다(`AGT-10`의 결).
 *
 * `mail`(P2)은 생성·완료를 스스로 판단하므로 실패 로그만 보고는 어느 축인지 알 수 없다. 생성 쪽으로
 * 합류시킨다 — 지금 우리 코드는 `mail` 실패 로그를 만들지 않고, 만들게 될 때 이 한 줄을 다시 본다.
 */
function handleHref(log: JobLogPayload): string {
  return log.source === "capture_complete"
    ? "/dashboard?view=all"
    : `/dashboard?new=1&from=${log.id}`;
}

export function HistoryList({
  logs,
  timeZone,
  now,
  openLogId,
  error,
}: {
  logs: JobLogPayload[];
  timeZone: string;
  now: Date;
  /** `?log=`로 짚인 기록. 앱 알림의 본문 클릭이 여는 자리이고(`NTF-4`), 거절된 기록을 짚는 자리다. */
  openLogId: string | null;
  /** `?error=`로 돌아온 되돌리기 거절 사유. 문장은 `lib/api/job-logs.ts`의 표가 붙인다. */
  error: string | undefined;
}) {
  if (logs.length === 0) {
    return <p className="text-body-s text-ink-secondary">{EMPTY_HISTORY}</p>;
  }

  /*
    거절 문구는 **거절된 항목 안에** 선다(사용자 결정 2026-09-24) — 100건까지 쌓이는 화면에서
    상단 배너는 "어느 것이 거절됐는지"를 말해 주지 못한다.

    짚히는 항목이 목록에 없으면 목록 위로 올린다. 그 사이 기록이 사라진 경우인데, 두지 않으면
    **문장이 갈 곳을 잃어 아무 일도 없었던 것처럼 보인다.** 닿기 어려운 경로지만 조용한 실패는
    만들지 않는다.
  */
  const orphan = error !== undefined && !logs.some((log) => log.id === openLogId);

  return (
    <div className="flex flex-col gap-2">
      {orphan && <Alert>{revertErrorMessage(error)}</Alert>}

      <ul className="flex flex-col gap-2">
        {logs.map((log) => {
          const open = log.id === openLogId;
          return (
            <HistoryItem
              key={log.id}
              log={log}
              timeZone={timeZone}
              now={now}
              open={open}
              error={open ? error : undefined}
            />
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 기록 한 건.
 *
 * 🔴 **`<li>`가 계약의 자리다.** `data-*` 셋과 `aria-current`가 전부 여기 붙는다 — 검증이 한
 * 요소에서 출발하고, 안쪽 마크업을 바꿔도 계약이 흔들리지 않는다.
 *
 * `aria-current`를 링크가 아니라 `<li>`에 다는 것은 이 항목이 **누르는 것이 아니기** 때문이다.
 * 딥링크로 열린 기록은 "지금 보고 있는 것"이지 "지금 눌린 것"이 아니다.
 */
function HistoryItem({
  log,
  timeZone,
  now,
  open,
  error,
}: {
  log: JobLogPayload;
  timeZone: string;
  now: Date;
  open: boolean;
  /** 이 항목이 거절 대상일 때만 실려 온다. */
  error: string | undefined;
}) {
  const failed = log.outcome === "failed";

  return (
    <li
      data-log-id={log.id}
      data-source={log.source}
      data-outcome={log.outcome}
      // 되돌릴 수 있는지를 버튼의 존재로 유추하지 않게 마크업에 적는다. 버튼은 `L-P1-04`에서 는다.
      data-revertable={String(log.revertable)}
      aria-current={open ? "page" : undefined}
      className={`flex flex-col gap-2 rounded-card border bg-surface px-4 py-3 ${
        open ? "border-brand" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `<time datetime>`에는 **원본 ISO 문자열**이 들어간다. 눈에 보이는 문구는 사용자 시간대로
          접힌 것이라, 기계가 읽을 값은 접히기 전의 순간이어야 한다.
        */}
        <time dateTime={log.createdAt} className="num text-body-s text-ink-secondary">
          {formatMoment(log.createdAt, timeZone, now)}
        </time>
        <span className="text-caption text-ink-secondary">{SOURCE_LABEL[log.source]}</span>
        <StatusPill tone={failed ? "error" : "neutral"}>{OUTCOME_LABEL[log.outcome]}</StatusPill>
      </div>

      {/* 캡처 원본은 남지 않는다(`AGT-10`). 무엇을 보고 한 일인지 말해 주는 것은 이 한 줄뿐이다. */}
      <p className={`text-body ${log.captureSummary ? "text-ink" : "text-ink-disabled"}`}>
        {log.captureSummary ?? NO_SUMMARY}
      </p>

      {failed && (
        <p className="text-body-s text-error-ink">
          {failureSentence(log.failureReason)}
        </p>
      )}

      {/* 완료 로그의 근거(`L-P1-01`). 완료 오판을 교정하려면 왜 닫았는지를 읽어야 한다. */}
      {log.rationale && <p className="text-body-s text-ink-secondary">{log.rationale}</p>}

      {log.tasks.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-s">
          <span className="text-ink-secondary">관련 태스크</span>
          {log.tasks.map((task) => (
            // 상세 패널을 여는 주소는 대시보드가 이미 쓰는 것과 같다(`?task=`). 지워진 태스크의
            // 링크를 눌러도 "찾을 수 없습니다" 패널로 합류해 따로 막을 것이 없다.
            <Link key={task.id} href={`/dashboard?task=${task.id}`} className="text-brand underline">
              {task.title}
            </Link>
          ))}
        </p>
      )}

      {error !== undefined && <Alert>{revertErrorMessage(error)}</Alert>}

      {/*
        교정 동선(`HIST-2`·`HIST-3`). 두 버튼은 **함께 나오지 않는다** — [직접 처리]는 실패한
        기록에만, [되돌리기]는 되돌릴 수 있는 기록에만 붙고 실패 기록은 늘 `NOTHING_TO_REVERT`로
        막힌다. 둘 다 없는 항목(이미 되돌린 성공 기록)에는 이 줄 자체가 그려지지 않는다.

        두 버튼 모두 2차다. 생성 되돌리기가 삭제를 한다고 `danger`를 주면 **완료 되돌리기가
        상대적으로 안전해 보이는데**, 사용자가 누르는 뜻은 둘 다 "에이전트가 한 일을 취소한다"
        하나다. 키트의 "채움 인디고는 카드마다 하나"도 지켜진다(행이 카드다).
      */}
      {(failed || log.revertable) && (
        <div className="flex flex-wrap justify-end gap-2">
          {failed && (
            <Link href={handleHref(log)} className={buttonClass("secondary", "sm")}>
              직접 처리
            </Link>
          )}

          {log.revertable && (
            /*
              🔴 `<button>`이다. `<a>`로 만들면 GET에 쓰기가 실리고, 행 안의 링크를 세는 기존
              검증(관련 태스크 정확히 N개)에도 끼어든다.
            */
            <form action={revertLog}>
              <input type="hidden" name="id" value={log.id} />
              {/* 짚고 있던 항목을 되돌린 뒤에도 계속 짚어 준다. */}
              <input type="hidden" name="log" value={open ? log.id : ""} />
              <Button tone="secondary" size="sm">
                되돌리기
              </Button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
