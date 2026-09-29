import type { ReactNode } from "react";
import Link from "next/link";

import { SOURCE_LABEL } from "@/app/(app)/messages";
import {
  Alert,
  AutoBadge,
  Button,
  Field,
  StatusPill,
  buttonClass,
  cardClass,
  inputClass,
} from "@/components/ui";
import { tagErrorMessage, UNCATEGORIZED } from "@/lib/api/tags";
import type { TaskPayload } from "@/lib/api/tasks";
import { describeDue, toDueInputs } from "@/lib/time";

import {
  createTask,
  deleteTagAction,
  deleteTask,
  mergeTagsAction,
  renameTagAction,
  saveTask,
} from "./actions";
import { dashboardMessage, NO_RATIONALE } from "./messages";
import { StatusToggle } from "./ui";
import { dashboardUrl, type View } from "./url";

/**
 * 태스크 상세 패널(`DASH-3`·`DASH-4`) — 서버가 그린다.
 *
 * **열림 여부가 URL에 있다**(`?task=<uuid>`, 새 태스크는 `?new=1`). 클라이언트 상태를 만들지
 * 않으므로 주소만으로 같은 화면을 다시 열 수 있고, 앱 알림의 딥링크(`NTF-2`)가 공짜로 따라온다.
 *
 * 폼이 셋인 것은 HTML이 폼 중첩을 금지하기 때문이다. [저장]·완료 표시·[삭제]는 보내는 것이 서로
 * 달라 한 폼에 담을 수 없다.
 *
 * 패널은 **자기 카드**라 자기 인디고 채움 버튼([추가]/[저장])을 하나 가질 수 있다. 키트의
 * "화면마다 하나"는 카드 단위로 읽는다(키트 3-2) — 본문 헤더의 [새 태스크]와 겹치지 않는다.
 */

/** 읽기 전용 항목 한 줄. 값이 없어도 **자리는 남긴다** — 6개 항목은 언제나 6개다(`DASH-3`). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {/*
        🔴 `<dt>`의 글자는 그대로 둔다. 검증이 `getByText("마감일", { exact: true })`라 콜론도,
        아이콘도, 부가 설명도 한 글자 붙일 수 없다. 꾸밀 것이 있으면 `<dd>` 쪽에 붙인다.
      */}
      <dt className="text-caption text-ink-secondary">{label}</dt>
      <dd className="text-body-s text-ink">{children}</dd>
    </div>
  );
}

function Shell({
  title,
  closeHref,
  leading,
  children,
  /*
    🔴 태그 관리 패널은 **반드시 자기 이름을 준다.** 기본값으로 두면
    `getByRole("complementary", { name: "태스크 상세" })`(task-panel·history 스펙)가 태그 패널까지
    집는다. 이름이 둘이어도 랜드마크가 흐려지지 않는 것은 **패널 슬롯이 하나**라 둘이 동시에
    서지 않기 때문이다(`url.ts`의 `panelOf`).
  */
  label = "태스크 상세",
}: {
  title: string;
  closeHref: string;
  /** 제목 앞에 서는 것 — 태스크 상세의 완료 표시(`DASH-10`). 행과 같은 자리(왼쪽)에 둔다. */
  leading?: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    // 목록 섹션 바깥에 둔다. 안에 넣으면 패널의 제목이 섹션의 태스크 수 검증에 섞인다.
    <aside
      aria-label={label}
      className={`${cardClass} flex h-fit w-full shrink-0 flex-col gap-4 px-4 py-4 lg:w-80`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          {leading}
          <h2 className="font-heading text-h2 text-ink">{title}</h2>
        </div>
        <Link href={closeHref} aria-label="패널 닫기" className={buttonClass("quiet", "sm")}>
          닫기
        </Link>
      </div>
      {children}
    </aside>
  );
}

function FormError({ code }: { code: string | undefined }) {
  const message = dashboardMessage(code);
  if (!message) return null;

  return <Alert>{message}</Alert>;
}

/**
 * 제목·설명·마감·태그를 한 폼에 담는다. **보기/편집 모드를 나누지 않는다** — 나누면 모드가 URL에
 * 하나 더 실리고, 사후 교정이 목적인 화면에서 '수정' 버튼은 한 번의 군더더기다.
 *
 * **태그 칸의 경위.** HF-03(2026-09-26)에서 태그 체크박스를 통째로 뺐다 — 태그 수만큼 폼이 길어져서였다.
 * 그러자 웹에서 태그를 고칠 곳이 사라졌고, 에이전트가 '미분류'로 보낸 태스크는 영영 '미분류'였다
 * (QA 보고, HF-10). 그래서 **한 줄짜리 단일 선택**으로 되돌렸다. 태스크 대부분은 태그가 하나다.
 * 아래 '새 태그' 칸은 태그가 '미분류'뿐인 계정에서 고를 것을 만든다.
 *
 * ⚠️ 단일 선택이라 **태그를 건드리지 않았으면 `tagIds`를 보내지 않는다**(`saveTask`). 에이전트가
 * 둘을 단 태스크를 제목만 고쳐 저장했을 때 하나로 줄어들지 않게 — `patchTask`는 `tagIds`가 오면
 * 그대로 덮어쓴다. 판정은 `tagOriginal`(처음 골라져 있던 값)과의 비교다.
 */
function Fields({
  task,
  tags,
  timeZone,
  draftTitle,
}: {
  task: TaskPayload | null;
  tags: { id: string; name: string }[];
  timeZone: string;
  /**
   * 새 태스크의 제목 초안(`HIST-2`). 히스토리의 [직접 처리]가 실어 보낸 작업 로그의 캡처 요약이고,
   * **`task`가 있으면 쓰이지 않는다** — 편집 중인 태스크의 제목을 초안이 덮을 수는 없다.
   */
  draftTitle?: string | null;
}) {
  const due = toDueInputs(task?.dueAt ?? null, timeZone);
  // 태그가 없는 태스크(예전에 직접 만든 것)도 '미분류'가 골라진 채 열린다. 그대로 저장하면
  // `tagOriginal`과 같아 아무것도 붙지 않는다 — 여는 것만으로 태그가 생기지 않는다.
  const selectedTag =
    task?.tags[0]?.id ?? tags.find((item) => item.name === UNCATEGORIZED)?.id ?? "";

  return (
    <>
      <Field label="제목">
        <input
          type="text"
          name="title"
          defaultValue={task?.title ?? draftTitle ?? ""}
          required
          className={inputClass}
        />
      </Field>

      <Field label="설명">
        <textarea
          name="description"
          rows={3}
          defaultValue={task?.description ?? ""}
          className={inputClass}
        />
      </Field>

      {/*
        입력이 둘이라 `<label>`로 감쌀 수 없다(하나의 label은 하나의 컨트롤만 가리킨다).
        보이는 "마감일"은 텍스트 노드로 두고, 각 입력은 `aria-label`로 제 이름을 받는다.
        이 비대칭은 의도다 — 검증이 `getByText("마감일", { exact: true })`와
        `getByLabel("마감 날짜")` 양쪽을 쓴다.
      */}
      <div className="flex flex-col gap-1 text-label text-ink-secondary">
        마감일
        {/*
          두 입력에 `min-w-0` — 날짜·시각 입력은 브라우저가 정한 최소 폭이 있어 flex 안에서 줄지 않고
          320px 패널 밖으로 8px 넘쳤다(HF-10 화면 확인에서 발견).
        */}
        <div className="flex gap-2">
          <input
            type="date"
            name="dueDate"
            aria-label="마감 날짜"
            defaultValue={due.date}
            className={`${inputClass} min-w-0`}
          />
          {/*
            시각이 없는 마감에 23:59를 채워 두지 않는다. 채우면 사용자가 저장만 해도
            "시각이 있는 마감"으로 바뀐다(설계 결정 14).
          */}
          <input
            type="time"
            name="dueTime"
            aria-label="마감 시각"
            defaultValue={task?.dueHasTime ? due.time : ""}
            className={`${inputClass} min-w-0`}
          />
        </div>
      </div>

      {/*
        `<select>`와 새 태그 입력이 한 칸에 선다 — 둘 다 "태그"를 정하고, 입력이 채워지면 이긴다.
        `aria-label`을 각자 준다(`TagSelect`의 주석 — 감싼 라벨은 옵션 글자까지 이름에 섞는다).
        폼 이름이 `tag`가 아닌 것은 그 이름을 필터를 나르는 hidden input이 이미 쓰고 있어서다.
      */}
      <div className="flex flex-col gap-1 text-label text-ink-secondary">
        태그
        <input type="hidden" name="tagOriginal" value={selectedTag} />
        <select name="tagId" aria-label="태그" defaultValue={selectedTag} className={inputClass}>
          {tags.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="newTag"
          aria-label="새 태그"
          placeholder="새 태그 이름 (선택)"
          className={inputClass}
        />
      </div>
    </>
  );
}

/** 딥링크로 들어왔는데 그 태스크가 없거나 남의 것일 때(`NTF-2`). 없는 것과 남의 것을 구분하지 않는다. */
export function MissingPanel({ closeHref }: { closeHref: string }) {
  return (
    <Shell title="태스크 상세" closeHref={closeHref}>
      <p className="text-body-s text-ink-secondary">
        태스크를 찾을 수 없습니다. 삭제되었을 수 있습니다.
      </p>
    </Shell>
  );
}

/** 새 태스크(`?new=1`). 아래쪽 읽기 전용 덩어리는 아직 사실이 없어 통째로 빠진다. */
export function NewTaskPanel({
  view,
  tag,
  tags,
  timeZone,
  error,
  from,
  draftTitle,
}: {
  view: View;
  tag: string | null;
  tags: { id: string; name: string }[];
  timeZone: string;
  error: string | undefined;
  /** 히스토리에서 이어받은 작업 로그(`?from=`). 저장이 거절돼도 초안을 다시 읽을 수 있게 나른다. */
  from: string | null;
  draftTitle: string | null;
}) {
  return (
    <Shell title="새 태스크" closeHref={dashboardUrl({ view, tag: tag ?? undefined })}>
      <FormError code={error} />
      <form action={createTask} className="flex flex-col gap-3">
        <input type="hidden" name="tag" value={tag ?? ""} />
        <input type="hidden" name="view" value={view} />
        {/*
          제목 초안이 아니라 **로그 id**를 나른다. 실패 리다이렉트가 `?from=`을 다시 실으면 서버가
          요약을 한 번 더 읽어 준다 — 요약 문장이 폼과 주소를 타고 흐르지 않는다.
        */}
        <input type="hidden" name="from" value={from ?? ""} />
        <Fields task={null} tags={tags} timeZone={timeZone} draftTitle={draftTitle} />
        <Button>추가</Button>
      </form>
    </Shell>
  );
}

export function TaskPanel({
  task,
  view,
  tag,
  tags,
  timeZone,
  error,
}: {
  task: TaskPayload;
  view: View;
  tag: string | null;
  tags: { id: string; name: string }[];
  timeZone: string;
  error: string | undefined;
}) {
  const closeHref = dashboardUrl({ view, tag: tag ?? undefined });
  const done = task.status === "done";
  // 행의 '자동' 배지와 같은 판정이다 — `manual`이 아닌 것은 전부 에이전트가 한 일이다.
  const auto = task.source !== "manual";
  const hidden = (
    <>
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="tag" value={tag ?? ""} />
      <input type="hidden" name="view" value={view} />
    </>
  );

  return (
    <Shell
      title="태스크 상세"
      closeHref={closeHref}
      leading={
        // 행과 같은 물건이다 — 누르면 뒤집히고, 이 패널로 돌아온다(`open`).
        <StatusToggle
          task={task}
          ring={
            done
              ? "done"
              : task.dueAt
                ? describeDue(task.dueAt, task.dueHasTime, timeZone, new Date()).state
                : "none"
          }
          tag={tag}
          view={view}
          open={task.id}
        />
      }
    >
      <FormError code={error} />

      <form action={saveTask} className="flex flex-col gap-3">
        {hidden}
        <Fields task={task} tags={tags} timeZone={timeZone} />
        <Button>저장</Button>
      </form>

      {/*
        여기부터는 사용자가 고칠 수 없는 것들이다. 근거와 생성 경로는 **에이전트 판단을 사후에
        교정하기 위한 재료**라 값이 없어도 항목을 지우지 않는다(`DASH-3`).
      */}
      <dl className="flex flex-col gap-3 border-t border-line pt-4">
        <Fact label="상태">
          {/* 바꾸는 것은 제목 앞의 완료 표시다. 여기는 상태를 **보여 주기만** 한다(`DASH-3`). */}
          <StatusPill>{done ? "완료" : "할 일"}</StatusPill>
        </Fact>

        <Fact label="근거">
          {task.rationale ?? <span className="text-ink-disabled">{NO_RATIONALE}</span>}
        </Fact>

        <Fact label="생성 경로">
          {/*
            에이전트가 만든 것에는 '자동' 배지를 씌운다 — 행의 배지와 같은 모양이라 목록에서 보던
            표시가 여기서 이어진다. 문구는 `SOURCE_LABEL` 그대로라 검증이 그대로 산다.
          */}
          {auto ? (
            <AutoBadge>{SOURCE_LABEL[task.source]}</AutoBadge>
          ) : (
            <StatusPill>{SOURCE_LABEL[task.source]}</StatusPill>
          )}
        </Fact>
      </dl>

      <form action={deleteTask} className="flex justify-end border-t border-line pt-4">
        {hidden}
        <Button tone="danger" size="sm">
          삭제
        </Button>
      </form>
    </Shell>
  );
}

/* ──────────────────── 태그 관리 패널 (`DASH-6`의 화면, `L-P1-06`) ──────────────────── */

/**
 * 태그 이름 변경·삭제·병합(`/dashboard?tags=1`). **새 화면을 만들지 않고** 태스크 상세와 같은
 * 슬롯을 쓴다 — 둘 중 어느 것이 서는지는 `url.ts`의 `panelOf`가 혼자 정한다.
 *
 * 🔴 **`?error=`의 어휘가 태스크 패널과 다르다.** 여기는 `lib/api/tags.ts`의 대문자 `reason` 토큰을
 * 그대로 받아 `tagErrorMessage()`로 풀고, 태스크 패널은 소문자 화면 코드를 `dashboardMessage()`로
 * 푼다. 한 칸(`?error=`)을 둘이 나눠 쓰는데 안전한 이유는 **두 패널이 동시에 서지 않기** 때문이고,
 * 어휘가 대소문자로 서로소라 섞여도 오해가 생기지 않는다. 태그 쪽이 API 코드를 쓰는 이유는
 * 그 문장들이 이미 사용자에게 보내는 완성된 한국어이기 때문이다(`409` 본문과 같은 표, `API-5`).
 */
export function TagManagePanel({
  tags,
  view,
  tag,
  error,
}: {
  tags: { id: string; name: string }[];
  /** 지금 걸린 태그 필터. 조작 내내 따라다녀야 한다. */
  view: View;
  tag: string | null;
  error: string | undefined;
}) {
  /*
    '미분류'는 출발이 될 수 없다 — 병합으로 사라지면 `AGT-5`의 전제가 무너진다. 도착으로는 쓸 수
    있어 아래 `tags`에 그대로 남는다(보호가 대칭이 아닌 것이 의도다, 계약 §태그 합치기).
    id가 아니라 **이름으로** 거르는 것은 API의 `.neq("name", …)`·DB 함수의 WHERE와 같은 기준을
    쓰기 위해서다.
  */
  const sources = tags.filter((item) => item.name !== UNCATEGORIZED);

  return (
    <Shell title="태그 관리" label="태그 관리" closeHref={dashboardUrl({ view, tag: tag ?? undefined })}>
      {error !== undefined && <Alert>{tagErrorMessage(error)}</Alert>}

      <ul className="flex flex-col gap-2">
        {tags.map((item) =>
          item.name === UNCATEGORIZED ? (
            /*
              행은 그리되 폼만 뺀다. 목록에서 지우면 사이드바 필터에는 보이는 태그가 여기엔 없어
              "내 태그가 아닌가"가 된다. **"(보호됨)" 같은 글자를 붙이지 않는다** — 행 글자가 늘면
              목록 텍스트를 보는 검증 표면이 는다.
            */
            <li key={item.id} data-tag-id={item.id} className="px-3 py-2 text-body-s text-ink-secondary">
              {item.name}
            </li>
          ) : (
            <li key={item.id} data-tag-id={item.id} className="flex flex-wrap items-center gap-2">
              <form action={renameTagAction} className="flex min-w-0 flex-1 items-center gap-2">
                <input type="hidden" name="tag" value={tag ?? ""} />
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="id" value={item.id} />
                {/*
                  `Field`로 감싸지 않는다 — 라벨 줄이 태그 수만큼 생겨 320px 패널이 세로로 두 배가
                  된다. 대신 `aria-label`로 제 이름을 받는다(마감 두 칸이 쓰는 것과 같은 비대칭).
                  이름이 유일한 것은 `(user_id, name)` 유니크가 보증한다.
                */}
                <input
                  type="text"
                  name="name"
                  aria-label={`${item.name} 이름`}
                  defaultValue={item.name}
                  required
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <Button tone="secondary" size="sm">
                  저장
                </Button>
              </form>

              <form action={deleteTagAction}>
                <input type="hidden" name="tag" value={tag ?? ""} />
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="id" value={item.id} />
                <Button tone="danger" size="sm">
                  삭제
                </Button>
              </form>
            </li>
          ),
        )}
      </ul>

      {/*
        고를 것이 없으면(태그가 '미분류'뿐인 새 계정) 통째로 그리지 않는다. 빈 `<select>` 둘과
        누를 수 있는 [바꾸기]를 두면 눌러도 아무 일이 안 일어난다.
      */}
      {sources.length > 0 && (
        <form action={mergeTagsAction} className="flex flex-col gap-3 border-t border-line pt-4">
          <input type="hidden" name="tag" value={tag ?? ""} />
          <input type="hidden" name="view" value={view} />
          <fieldset className="flex flex-col gap-3">
            {/*
              `<legend>`는 `fieldset`의 flex 흐름 밖에 놓여 `gap-3`이 걸리지 않는다 — 실제 렌더에서
              머리글과 첫 라벨이 딱 붙어 보였다. 간격을 여기서 직접 준다.
            */}
            <legend className="mb-2 text-label text-ink-secondary">태그 바꾸기</legend>

            {/*
              동작은 병합(API `merge`)이지만 화면 어휘는 **찾기/바꾸기**다(HF-12). "합치기"는
              어느 쪽이 남는지 읽히지 않는다는 피드백이 왔고, 사용자는 오피스 앱의 [바꾸기]에 이미
              익숙하다 — "기존 태그를 바꿀 태그로"라는 한 문장이 방향과 사라지는 쪽을 함께 말한다.
              둘째 칸을 '신규 태그'로 쓰지 않은 것은 고르는 칸이라서다. 새 태그가 생긴다고 읽히면
              안 된다(사용자 결정 2026-09-29).
            */}
            <TagSelect name="sourceId" label="기존 태그" options={sources} />
            <TagSelect name="targetId" label="바꿀 태그" options={tags} />
          </fieldset>
          <Button>바꾸기</Button>
        </form>
      )}
    </Shell>
  );
}

/**
 * 저장소의 첫 `<select>`다. 네이티브를 그대로 쓰고 `appearance-none` + 커스텀 셰브론을 하지 않는다 —
 * 클라이언트 JS 0으로 키보드 조작과 모바일 휠 피커까지 공짜로 주는 유일한 컨트롤이다.
 *
 * 🔴 **`aria-label`을 따로 준다 — `Field`의 암묵 연결만으로는 이름이 오염된다.** `<label>`이
 * `<select>`를 감싸면 접근 이름이 라벨의 **텍스트 전체**가 되는데 거기에 모든 `<option>` 글자가
 * 섞여 들어온다(실측: `없어질 태그태그를 고르세요업무학업…` — 라벨이 HF-12 전의 것이다). 그러면 `getByLabel("바꿀 태그")`가
 * 옵션에 그 글자를 가진 다른 select까지 집는다. `aria-label`이 암묵 라벨을 이기므로 이름이 다시
 * 깨끗해지고, 보이는 글자와 같은 문자열이라 WCAG 2.5.3(Label in Name)도 지켜진다. 마감 두 칸이
 * 쓰는 것과 같은 비대칭이고 이유도 같다 — `<input>`에는 없던 문제가 `<select>`에서 생긴다.
 *
 * 🔴 **빈 값의 첫 `<option>`이 있어야 `required`가 작동한다.** HTML 명세의 *placeholder label option*은
 * "첫 option의 value가 빈 문자열"일 때만 성립한다. 빠뜨리면 브라우저 검증이 조용히 꺼져, 손대지
 * 않고 누르면 첫 태그끼리 병합을 시도해 `TAG_MERGE_SAME`이 뜬다. 서버 검증(`mergeTags`)은 그대로
 * 두는데, 이중이 아니라 층이 다르다 — 브라우저 검증이 꺼진 경우의 뒷문이다.
 */
function TagSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: { id: string; name: string }[];
}) {
  return (
    <Field label={label}>
      <select name={name} aria-label={label} required defaultValue="" className={inputClass}>
        <option value="">태그를 고르세요</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
