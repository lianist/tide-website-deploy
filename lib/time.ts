/**
 * 시간대 계산 — **에이전트와 화면이 함께 쓰는 한 벌.**
 *
 * 에이전트의 상대 날짜 환산(`AGT-4`)과 대시보드의 마감 판정·표시(`DASH-1`)가 같은 오프셋 계산을
 * 쓴다. 두 벌이 되는 순간 서머타임 버그가 한쪽에만 생기므로 `lib/` 바로 밑에 둔다 — 화면이
 * `lib/agent/`를 import 하게 두지 않는다(대시보드는 에이전트를 모른다).
 *
 * 모델은 캡처를 읽어 `YYYY-MM-DD`와 `HH:MM`만 낸다. 시간대 오프셋 계산(서머타임 포함)은 틀려도
 * 티가 나지 않는 종류의 실수라, 결정적인 코드로 여기서 한다(`docs/03-Architecture.md` §설계 결정 14).
 * 새 의존성 없이 `Intl`만 쓴다.
 */

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 그 순간이 `timeZone`에서 몇 년 몇 월 며칠 몇 시인지. */
function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** `timeZone`이 그 순간 UTC보다 몇 ms 앞서 있는지. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `timeZone`에서 `now`가 속한 하루의 시작과 다음 날의 시작(ISO) — 대시보드 '오늘' 보기의 경계(`DASH-9`).
 *
 * 🔴 `describeDue`의 `today`로 대신하지 않는다. 그것은 "아직 안 지난 오늘"이라 오늘 이미 지난
 * 마감(`overdue`)을 빼고, 완료 태스크의 "마감이 오늘"도 물을 수 없다. 여기는 달력의 하루만 잰다.
 * 날짜만 있는 마감은 그날 23:59:59에 놓이므로(설계 결정 14) `[start, end)` 안에 든다.
 */
export function dayBounds(timeZone: string, now: Date): { start: string; end: string } {
  const p = zonedParts(now, timeZone);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  return {
    start: toDueAt(ymd(p.year, p.month, p.day), "00:00", timeZone)!,
    end: toDueAt(
      ymd(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()),
      "00:00",
      timeZone,
    )!,
  };
}

/**
 * `9월 24일 (목)` — **해가 다를 때만** 연도를 붙인다. 목록 끝에는 1년 넘은 마감이 남을 수 있어
 * "1월 3일"만 보이면 거짓말이 된다.
 *
 * `Intl`의 `format()`을 쓰지 않는다 — 출력 구두점이 런타임 ICU 버전에 따라 달라져(로컬 Node와
 * Vercel이 다르다) 화면 문구가 환경에 묶인다. `formatToParts`로 숫자만 받아 손으로 조립한다.
 */
function dateLabel(p: { year: number; month: number; day: number }, thisYear: number): string {
  const weekday = WEEKDAYS_KO[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return p.year === thisYear
    ? `${p.month}월 ${p.day}일 (${weekday})`
    : `${p.year}년 ${p.month}월 ${p.day}일 (${weekday})`;
}

/**
 * 이미 지난 한 순간을 사용자 시간대로 읽는다 — `9월 24일 (목) 12:00`. 히스토리의 작업 로그
 * 시각(`HIST-1`)이 쓴다.
 *
 * 마감(`describeDue`)과 **같은 날짜 규칙**을 일부러 공유한다. 한 서비스 안에서 날짜가 두 모양으로
 * 보이면 같은 날인지 눈으로 맞춰 보게 된다. 다른 점은 시각이 **언제나 있다**는 것뿐이다 —
 * 일어난 기록에는 "날짜만 아는 순간"이 없다.
 */
export function formatMoment(instant: string, timeZone: string, now: Date): string {
  const p = zonedParts(new Date(instant), timeZone);
  return `${dateLabel(p, zonedParts(now, timeZone).year)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * 모델에게 보여 줄 캡처 시각 — `2026-09-19 (토) 21:00`. 요일을 서버가 계산해 붙여 두면
 * '다음 주 월요일' 같은 표현을 모델이 요일 계산 없이 풀 수 있다.
 */
export function formatLocal(capturedAt: string, timeZone: string): string {
  const p = zonedParts(new Date(capturedAt), timeZone);
  const weekday = WEEKDAYS_KO[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${p.year}-${pad(p.month)}-${pad(p.day)} (${weekday}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * 모델이 낸 마감(현지 날짜 + 선택 시각)을 `due_at`에 넣을 UTC 순간으로 바꾼다.
 * 시각이 없으면 그날의 끝(23:59:59)이다 — 마감은 "언제까지"이기 때문이다(설계 결정 14).
 *
 * 날짜가 실재하지 않으면(`2026-02-30`, 모양만 맞는 출력) null — 추측해서 굴려 넣지 않는다(`AGT-4`).
 */
export function toDueAt(date: string, time: string | null, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = time === null ? null : /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || (time !== null && !t)) return null;

  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute, second] = t ? [Number(t[1]), Number(t[2]), 0] : [23, 59, 59];

  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  // 벽시계를 UTC로 읽은 값에서 오프셋을 뺀다. 오프셋은 결과 순간에서 다시 재야 서머타임 경계에서 맞는다.
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone)).toISOString();
}

/**
 * `toDueAt`의 반대 — 저장된 마감을 상세 패널의 `<input type="date">`·`<input type="time">`에
 * 채울 조각으로 되돌린다.
 *
 * **`dueAt.slice(0, 10)`으로 때울 수 없다.** 날짜만 있는 마감은 사용자 시간대의 23:59:59로
 * 저장되므로(설계 결정 14), UTC로 읽은 날짜가 시간대에 따라 하루 어긋난다 — KST(UTC+9)의
 * 9월 23일 마감은 `…T14:59:59Z`(같은 날)지만 UTC+14에서는 `…T09:59:59Z`(역시 같은 날처럼
 * 보이나 시각이 다르고), UTC-5에서는 아예 다음 날이 된다.
 *
 * `dueHasTime`이 false면 호출부가 `time`을 버린다 — 23:59를 칸에 채워 두면 사용자가 저장만 해도
 * "시각이 있는 마감"으로 바뀐다.
 */
export function toDueInputs(
  dueAt: string | null,
  timeZone: string,
): { date: string; time: string } {
  if (!dueAt) return { date: "", time: "" };

  const p = zonedParts(new Date(dueAt), timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** `DASH-1`의 강조 단계. 미완료 태스크에만 쓰인다. */
export type DueState = "overdue" | "today" | "upcoming";

export interface DueView {
  state: DueState;
  /** 사람이 읽는 마감. `dueHasTime`이 false면 시각이 없다(계약 §태스크). */
  label: string;
}

/**
 * 마감 한 건을 사용자 시간대로 읽는다 — 판정과 표시를 한 함수가 함께 낸다. 둘을 나누면 같은
 * 순간을 두 번 재게 되어 "오늘이라고 쓰고 어제 날짜를 보여 주는" 어긋남이 생긴다.
 *
 * **오늘이면서 이미 지난 마감은 `overdue`다.** `DASH-1`은 둘 다 강조하라고만 하므로 어느 쪽을
 * 골라도 강조는 걸리고, 갈리는 것은 어느 색이 더 급한 사실을 말하느냐다 — "이미 늦었다"가
 * "오늘까지다"보다 강하다. 날짜만 있는 마감이 그날의 끝(23:59:59)에 놓인 덕분에(설계 결정 14)
 * 날짜 마감은 그날 내내 `today`로 남고 자정에 넘어간다. 두 종류가 각자 옳게 동작한다.
 *
 * `dueAt`이 null인 자리에서는 부르지 않는다 — 마감 없음은 상태가 아니라 부재다.
 */
export function describeDue(
  dueAt: string,
  dueHasTime: boolean,
  timeZone: string,
  now: Date,
): DueView {
  const instant = new Date(dueAt);
  const due = zonedParts(instant, timeZone);
  const today = zonedParts(now, timeZone);

  const sameDay = due.year === today.year && due.month === today.month && due.day === today.day;
  const state: DueState =
    instant.getTime() < now.getTime() ? "overdue" : sameDay ? "today" : "upcoming";

  const date = dateLabel(due, today.year);

  // 시각 없는 마감에 23:59를 보여 주면 계약 위반이다(계약 §태스크).
  return { state, label: dueHasTime ? `${date} ${pad(due.hour)}:${pad(due.minute)}` : date };
}
