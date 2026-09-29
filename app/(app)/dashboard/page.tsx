import Link from "next/link";

import { Icon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import { isUuid } from "@/lib/api/input";
import {
  countNeedsReview,
  jobLogSummary,
  listNeedsReview,
  toJobLogPayload,
} from "@/lib/api/job-logs";
import { listTasks, selectTask, toTaskPayload } from "@/lib/api/tasks";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireConsentedUser, userTimeZone } from "@/lib/supabase/session";
import { dayBounds } from "@/lib/time";

import { AppShell } from "../shell";

import { MissingPanel, NewTaskPanel, TagManagePanel, TaskPanel } from "./panel";
import { TaskRealtime } from "./realtime";
import { ReviewBanner, ReviewList } from "./review";
import { showsTagFilter, TagFilter, TaskSection } from "./ui";
import { dashboardUrl, panelOf, type View, viewOf } from "./url";

export const metadata = { title: "대시보드 · Tide" };

/** 배열이거나 UUID가 아닌 값은 없는 것으로 본다 — 주소창은 사람이 치는 자리라 400을 내지 않는다. */
function uuidParam(value: string | string[] | undefined): string | null {
  return isUuid(value) ? value : null;
}

/**
 * 보기마다 다른 글자(`DASH-9`). 섹션 이름은 테스트가 붙잡는 랜드마크라 짧게, 헤더는 목업처럼 문장으로.
 * '확인 필요'는 태스크 목록이 아니라 섹션 글자를 `review.tsx`가 스스로 든다.
 */
const VIEW_TEXT: Record<View, { heading: string; section: string; empty: string }> = {
  today: {
    heading: "오늘 할 일",
    section: "오늘",
    empty: "오늘 마감이거나 마감이 지난 할 일이 없습니다.",
  },
  all: {
    heading: "전체 할 일",
    section: "할 일",
    empty: "할 일이 없습니다. 앱에서 화면을 캡처하면 여기에 쌓입니다.",
  },
  review: { heading: "확인 필요", section: "확인 필요", empty: "" },
  done: { heading: "완료한 일", section: "완료", empty: "완료한 태스크가 없습니다." },
};

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 대시보드 — `DASH-1`(정렬·강조) `DASH-2`(태그 표시·필터) `DASH-3`·`DASH-4`(상세 패널·직접 CRUD).
 *
 * **서버가 그린다.** '오늘 마감' 판정의 기준 시간대는 `profiles.timezone`이다 — Vercel은 UTC라
 * 서버 시간대로 판정하면 틀린다(`docs/03-Architecture.md` §설계 결정 19). 그 값은 캡처 API가
 * 요청마다 갱신한다.
 *
 * **화면의 모든 상태가 URL에 있다** — 필터(`?tag=`), 열린 패널(`?task=`), 새 태스크(`?new=1`),
 * 히스토리에서 이어받은 기록(`?from=`), 방금 실패한 것(`?error=`). 앱 알림의 딥링크(`NTF-2`)가
 * 따로 만들 것 없이 따라온다.
 *
 * 새로고침 없는 반영(`DASH-5`)은 `<TaskRealtime>`이 맡는다 — 저장소의 유일한 클라이언트 컴포넌트고,
 * **데이터를 들지 않고 "다시 그려라"만 말한다.** 목록은 여전히 서버가 그린다(설계 결정 21).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    tag?: string | string[];
    task?: string | string[];
    new?: string | string[];
    from?: string | string[];
    error?: string | string[];
  }>;
}) {
  const user = await requireConsentedUser();
  const supabase = await createServerSupabase();
  const params = await searchParams;

  const view = viewOf(params.view);
  const tagId = uuidParam(params.tag);
  // 🔑 오른쪽에 설 패널은 하나뿐이고, 그 순서는 `panelOf` **한 곳**에만 적혀 있다. 여기서
  // `isNew && !isTags` 같은 조건을 다시 조립하지 않는다 — 순서가 두 벌이 되는 순간 두 패널이
  // 동시에 열리고, `?error=`를 두 어휘가 나눠 쓰는 규약(태그는 대문자 사유, 태스크는 소문자
  // 화면 코드)까지 무너진다.
  const panel = panelOf(params);
  // UUID가 아닌 `?task=`를 그대로 넘기면 `selectTask`가 22P02로 터져 화면 전체가 500이 된다.
  // 없는 태스크와 같은 자리("찾을 수 없음")로 합류시킨다.
  const taskId = panel === "task" ? uuidParam(params.task) : null;
  // 히스토리의 [직접 처리]가 실어 보낸 작업 로그(`HIST-2`). 새 태스크 패널이 열릴 때만 쓰인다.
  const fromId = uuidParam(params.from);
  const error = first(params.error);

  // 한 번만 잰다. 행마다 `new Date()`를 부르면 자정 경계에서 한 화면 안의 판정이 갈릴 수 있다.
  const now = new Date();
  const tagFilter = tagId ?? undefined;
  // '오늘'의 경계는 계정 시간대의 하루라 그 보기만 시간대를 읽은 **뒤에** 목록을 읽는다. 나머지
  // 보기는 전부 한 번에 나간다.
  // 🔴 전부를 시간대 뒤에 줄 세우지 않는다 — 그렇게 했더니(`L-P1-10` 첫 구현) 서버 렌더가 한 왕복
  // 길어져, 페이지를 열자마자 저장하면 실시간 구독의 첫 따라잡기(`SUBSCRIBED` → refresh)가 저장
  // 결과를 옛 화면으로 덮는 경주가 드러났다(task-panel 스펙이 4회 중 1~2회 실패, 직전 커밋은 0회).
  const timeZonePromise = userTimeZone(supabase, user.id);
  const tasksPromise =
    view === "review"
      ? null
      : view === "today"
        ? timeZonePromise.then((zone) =>
            listTasks(supabase, { tagId: tagFilter, today: dayBounds(zone, now) }),
          )
        : listTasks(supabase, { tagId: tagFilter, status: view === "done" ? "done" : "todo" });

  const [timeZone, tasks, reviewLogs, reviewCount, tags, opened, draftTitle] = await Promise.all([
    timeZonePromise,
    // '확인 필요'는 태스크가 아니라 작업 로그를 읽는다. 안 그릴 목록은 읽지 않는다.
    tasksPromise,
    view === "review" ? listNeedsReview(supabase) : null,
    // 사이드바 배지와 '오늘' 배너가 함께 쓴다 — 한 번 세어 셸에 넘긴다.
    countNeedsReview(supabase),
    supabase.from("tags").select("id, name").order("name"),
    taskId ? selectTask(supabase, taskId) : null,
    // 패널이 열리지 않는 `?from=`은 쿼리를 쓰지 않는다. 없는·남의 로그와 요약이 없는 로그는
    // 전부 `null`이 되어 **빈 폼** 하나로 합류한다.
    panel === "new" && fromId ? jobLogSummary(supabase, fromId) : null,
  ]);
  if (tasks?.error || reviewLogs?.error || tags.error) {
    throw tasks?.error ?? reviewLogs?.error ?? tags.error;
  }

  // 태그 이름순 정렬이 `toTaskPayload` 한 곳에만 있다. 화면이 따로 정렬하면 API와 갈라진다.
  const rows = tasks?.data.map(toTaskPayload) ?? [];
  const text = VIEW_TEXT[view];

  const openedTask = opened?.data ? toTaskPayload(opened.data) : null;
  const closeHref = dashboardUrl({ view, tag: tagId ?? undefined });

  return (
    <AppShell
      current={view}
      needsReview={reviewCount}
      email={user.email}
      title={text.heading}
      action={
        <Link
          href={dashboardUrl({ view, tag: tagId ?? undefined, isNew: true })}
          className={buttonClass("primary", "sm")}
        >
          <Icon name="plus" size={16} />새 태스크
        </Link>
      }
      sidebar={
        showsTagFilter(tags.data) ? (
          <TagFilter tags={tags.data} selected={tagId} view={view} />
        ) : undefined
      }
    >
      {/*
        구독은 화면을 그리지 않는다(렌더가 `null`이라 레이아웃에 자리를 차지하지 않는다). `user.id`를
        서버에서 내려 준다 — 브라우저에서 다시 읽으면 구독 전에 `await`가 하나 끼어 첫 이벤트와
        경주한다. uid는 비밀이 아니다(쿠키 속 JWT의 `sub`가 이미 브라우저에 있다).
      */}
      <TaskRealtime userId={user.id} />

      <div className="flex flex-col-reverse gap-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {view === "today" && <ReviewBanner count={reviewCount} />}

          {reviewLogs ? (
            <ReviewList
              logs={reviewLogs.data.map(toJobLogPayload)}
              timeZone={timeZone}
              now={now}
            />
          ) : (
            <TaskSection
              title={text.section}
              tasks={rows}
              empty={tagId ? "이 태그에 해당하는 태스크가 없습니다." : text.empty}
              timeZone={timeZone}
              now={now}
              tag={tagId}
              view={view}
              openTaskId={openedTask?.id ?? null}
            />
          )}
        </div>

        {panel === "tags" ? (
          <TagManagePanel tags={tags.data} view={view} tag={tagId} error={error} />
        ) : panel === "new" ? (
          <NewTaskPanel
            view={view}
            tag={tagId}
            tags={tags.data}
            timeZone={timeZone}
            error={error}
            from={fromId}
            draftTitle={draftTitle}
          />
        ) : panel === "task" ? (
          openedTask ? (
            <TaskPanel
              /*
                입력칸이 비제어(`defaultValue`)라, 행 클릭(클라이언트 전환)으로 태스크가 바뀌어도
                React는 같은 `<input>`을 재사용해 앞 태스크의 값이 남는다(HF-08). 태스크가 바뀌면
                새로 마운트한다. `updatedAt`은 넣지 않는다 — Realtime 갱신이 치던 입력을 지운다.
              */
              key={openedTask.id}
              task={openedTask}
              view={view}
              tag={tagId}
              tags={tags.data}
              timeZone={timeZone}
              error={error}
            />
          ) : (
            <MissingPanel closeHref={closeHref} />
          )
        ) : null}
      </div>
    </AppShell>
  );
}
