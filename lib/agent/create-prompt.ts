import { formatLocal } from "@/lib/time";

/**
 * 생성 캡처 프롬프트 — `AGT-1`~`AGT-5`. 원칙은 `docs/07-Prompt-Principles.md`, 골격은 같은 문서 §C.
 *
 * **고칠 때는 `npm run grade`로 평가 세트를 다시 돌린다.** 케이스와 심어 둔 함정은
 * `e2e/fixtures/captures/README.md`에 있다. 한 케이스에 맞춰 문장을 조이면 다른 케이스가 깨지므로,
 * 고치기 전에 해당 케이스의 `note`부터 읽는다.
 */

/** 모델이 내는 모양. 스키마(`buildCreateSchema`)와 1:1이다 — **신뢰도 칸이 없다**(결정 기록 2). */
export interface CreateOutput {
  quotes: { speaker: "user" | "other" | "document"; text: string }[];
  summary: string;
  tasks: {
    title: string;
    description: string | null;
    dueDate: string | null;
    dueTime: string | null;
    tags: string[];
    rationale: string;
    /** 같은 일인 미완료 태스크의 번호(`AGT-11`). 새 일이면 null. */
    duplicateOfKey: string | null;
  }[];
}

/** 모델에게 보여 줄 미완료 태스크 한 건. `key`는 이 요청 안에서만 쓰는 번호다. */
export interface OpenTask {
  key: string;
  title: string;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/**
 * 미완료 태스크 번호를 **요청마다 enum으로 박는다**(`AGT-11`) — 완료 스키마(`buildCompleteSchema`)와
 * 같은 패턴이고 근거도 같다. 모델은 목록에 없는 태스크를 가리킬 수 없고, 번호 → id는 서버가 쥔다.
 * 후보가 없으면 null만 허용한다 — 빈 enum은 스키마로 성립하지 않는다.
 *
 * 판정을 이 호출 **안에서** 하는 이유는 `docs/03-Architecture.md` §설계 결정 27 — 두 번째 호출은
 * 10초 예산을 깨고, 서버의 문자열 비교는 표현만 다른 같은 일을 못 알아본다.
 */
export function buildCreateSchema(keys: string[]) {
  const duplicateOfKey =
    keys.length > 0
      ? {
          anyOf: [{ type: "string", enum: keys }, { type: "null" }],
          description: "이 태스크와 같은 일인 open_tasks의 번호. 새로운 일이면 null",
        }
      : { type: "null", description: "미완료 태스크가 없으므로 항상 null" };

  return {
    name: "capture_create",
    jsonSchema: {
      type: "object",
      properties: {
        quotes: {
          type: "array",
          description: "판단의 근거가 되는 캡처 속 문구와 그 말을 한 쪽. 태스크를 정하기 전에 먼저 채운다.",
          items: {
            type: "object",
            properties: {
              // 화자를 먼저 적게 한다. 메신저에서 사용자와 상대를 뒤바꾸는 것이 이 에이전트의 가장 흔한 오판이라
              // 지시문만으로는 막히지 않아서(L-P0-08 평가 2차) 칸으로 강제한다.
              speaker: {
                type: "string",
                enum: ["user", "other", "document"],
                description: "user = 사용자 본인이 쓴 말, other = 상대가 쓴 말, document = 대화가 아닌 문서·메일·공지 본문",
              },
              text: { type: "string", description: "원문 그대로" },
            },
            required: ["speaker", "text"],
            additionalProperties: false,
          },
        },
        summary: {
          type: "string",
          description: "캡처가 무엇인지 한국어 한 줄 요약. 태스크가 없어도 채운다(작업 로그에 남는다).",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "무엇을 해야 하는지 짧은 한국어 제목" },
              description: nullable({ type: "string", description: "제목만으로 부족한 세부. 없으면 null" }),
              dueDate: nullable({
                type: "string",
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                description: "마감 날짜 YYYY-MM-DD(사용자 시간대 기준). 드러나지 않으면 null",
              }),
              dueTime: nullable({
                type: "string",
                pattern: "^\\d{2}:\\d{2}$",
                description: "마감 시각 HH:MM(24시간제). 캡처에 시각이 적혀 있을 때만, 아니면 null",
              }),
              tags: {
                type: "array",
                description: "대개 하나. existing_tags의 이름을 글자 그대로 쓴다",
                items: { type: "string" },
              },
              rationale: { type: "string", description: "캡처에서 본 것을 근거로 왜 이 태스크인지 한 문장" },
              duplicateOfKey,
            },
            required: ["title", "description", "dueDate", "dueTime", "tags", "rationale", "duplicateOfKey"],
            additionalProperties: false,
          },
        },
      },
      required: ["quotes", "summary", "tasks"],
      additionalProperties: false,
    },
  };
}

export const CREATE_SYSTEM = `당신은 사용자의 화면 캡처에서 사용자가 해야 할 업무 태스크를 읽어내는 분석기다.
사용자는 생성 단축키를 눌러 이 캡처를 보냈다. 결과는 확인 없이 곧바로 사용자의 할 일 목록에 들어가고, 사용자가 나중에 고친다.
그래서 사용자에게 질문하지 않는다. 판단이 갈리면 가장 그럴듯한 쪽 하나로 확정한다.`;

const EXAMPLES = `<examples>
<example>
<capture>팀장의 메신저: "내일 오전까지 3분기 매출 자료 정리해서 보내주세요"</capture>
<context>captured_at 2026-03-10 (화) 16:00, existing_tags 영업, 미분류</context>
<output>{"quotes":[{"speaker":"other","text":"내일 오전까지 3분기 매출 자료 정리해서 보내주세요"}],"summary":"팀장이 3분기 매출 자료 정리를 요청한 메신저","tasks":[{"title":"3분기 매출 자료 정리해서 팀장에게 보내기","description":null,"dueDate":"2026-03-11","dueTime":null,"tags":["영업"],"rationale":"팀장이 '내일 오전까지' 매출 자료를 보내 달라고 요청했다.","duplicateOfKey":null}]}</output>
<why>'오전까지'는 시각이 아니다. 시각이 숫자로 적히지 않았으니 dueTime은 null이다.</why>
</example>
<example>
<capture>회의록: "1) 김OO: 견적서 수정 2) 나: 고객사에 일정 회신(금요일까지) 3) 다음 회의는 공지 예정"</capture>
<context>captured_at 2026-03-09 (월) 11:00, existing_tags 영업, 미분류</context>
<output>{"quotes":[{"speaker":"document","text":"나: 고객사에 일정 회신(금요일까지)"},{"speaker":"document","text":"다음 회의는 공지 예정"}],"summary":"담당자별 할 일이 정리된 회의록","tasks":[{"title":"고객사에 일정 회신하기","description":null,"dueDate":"2026-03-13","dueTime":null,"tags":["영업"],"rationale":"회의록에서 사용자에게 배정된 항목이 금요일까지 일정 회신이다.","duplicateOfKey":null}]}</output>
<why>번호가 셋이어도 하나는 남의 일, 하나는 안내다. 사용자가 할 일만 태스크가 된다.</why>
</example>
<example>
<capture>메신저: 왼쪽에 동료 이름과 함께 "보고서 공유드려요"와 파일(보관 기한 ~3/20). 오른쪽 말풍선 "확인했어요, 고칠 건 없네요". 왼쪽 동료 "넵, 그럼 제가 최종본으로 올릴게요"</capture>
<context>captured_at 2026-03-12 (목) 10:00, existing_tags 영업, 미분류</context>
<output>{"quotes":[{"speaker":"other","text":"보고서 공유드려요"},{"speaker":"user","text":"확인했어요, 고칠 건 없네요"},{"speaker":"other","text":"넵, 그럼 제가 최종본으로 올릴게요"}],"summary":"동료가 공유한 보고서를 확인하고 답한 대화","tasks":[{"title":"동료 공유 보고서 검토 회신하기","description":null,"dueDate":null,"dueTime":null,"tags":["영업"],"rationale":"보고서 공유와 확인 답장이 오간 업무 대화로, 남은 요청은 보이지 않는다.","duplicateOfKey":null}]}</output>
<why>최종본을 올리는 것은 동료가 하겠다고 한 일이라 사용자의 태스크가 아니다. 업무 맥락은 있지만 사용자에게 남은 할 일이 없으니 요약 제목 하나에 마감 없음. 요약 제목도 다른 태스크처럼 '~하기'로 끝맺는다. 파일 보관 기한은 할 일의 마감이 아니다.</why>
</example>
<example>
<capture>단체 공지: "정기 대회 참가비 입금 안내 — 이번 주 금요일까지 총무 계좌로 보내 주세요. 코트 배정은 추후 공지" / 같은 날 따로 받은 문자: "치과 예약 3/20(금) 오후 2시 확정되었습니다"</capture>
<context>captured_at 2026-03-16 (월) 09:00, existing_tags 영업, 동호회, 미분류</context>
<output>{"quotes":[{"speaker":"document","text":"정기 대회 참가비 입금 안내 — 이번 주 금요일까지 총무 계좌로 보내 주세요"},{"speaker":"document","text":"치과 예약 3/20(금) 오후 2시 확정되었습니다"}],"summary":"대회 참가비 입금 공지와 치과 예약 확정 문자","tasks":[{"title":"정기 대회 참가비 총무 계좌로 입금하기","description":null,"dueDate":"2026-03-20","dueTime":null,"tags":["동호회"],"rationale":"단체 공지가 금요일까지 참가비 입금을 요청했다.","duplicateOfKey":null},{"title":"치과 예약 방문하기","description":null,"dueDate":"2026-03-20","dueTime":"14:00","tags":["미분류"],"rationale":"치과 예약이 3/20 오후 2시로 확정되었다.","duplicateOfKey":null}]}</output>
<why>'동호회'라는 말은 없지만 대회·총무·코트 배정이 동호회 활동이라는 단서다. 치과 예약은 사용자가 속한 조직·활동에서 온 일이 아니라 개인 볼일이니 새 태그를 만들지 않고 '미분류'다.</why>
</example>
<example>
<capture>임대인의 문자: "다음 달 관리비 고지서 보내드려요. 25일까지 납부 부탁드립니다. 그리고 계약 갱신 여부도 이번 달 안에 알려 주세요."</capture>
<context>captured_at 2026-03-17 (화) 19:00, existing_tags 집, 미분류, open_tasks 1. 관리비 이체하기 / 2. 전세 계약서 사본 스캔하기</context>
<output>{"quotes":[{"speaker":"other","text":"25일까지 납부 부탁드립니다."},{"speaker":"other","text":"계약 갱신 여부도 이번 달 안에 알려 주세요."}],"summary":"임대인이 관리비 납부와 계약 갱신 회신을 요청한 문자","tasks":[{"title":"다음 달 관리비 납부하기","description":null,"dueDate":"2026-03-25","dueTime":null,"tags":["집"],"rationale":"임대인이 25일까지 관리비 납부를 요청했다.","duplicateOfKey":"1"},{"title":"임대인에게 계약 갱신 여부 회신하기","description":null,"dueDate":"2026-03-31","dueTime":null,"tags":["집"],"rationale":"임대인이 이번 달 안에 계약 갱신 여부를 알려 달라고 했다.","duplicateOfKey":null}]}</output>
<why>관리비 납부는 표현만 다를 뿐 1번과 같은 일이다. 계약 갱신 회신은 2번과 같은 계약 주제지만 해야 할 행동이 다르므로 새 일이다.</why>
</example>
<example>
<capture>인사팀 메일: "연말정산 증빙서류를 1월 15일까지 인사시스템에 올려 주세요."</capture>
<context>captured_at 2026-01-05 (월) 10:00, existing_tags 동호회, 미분류</context>
<output>{"quotes":[{"speaker":"document","text":"연말정산 증빙서류를 1월 15일까지 인사시스템에 올려 주세요."}],"summary":"인사팀이 연말정산 증빙서류 업로드를 요청한 메일","tasks":[{"title":"연말정산 증빙서류 인사시스템에 올리기","description":null,"dueDate":"2026-01-15","dueTime":null,"tags":["직장"],"rationale":"인사팀이 1월 15일까지 연말정산 증빙서류를 올려 달라고 했다.","duplicateOfKey":null}]}</output>
<why>인사팀·연말정산은 사용자가 다니는 직장에서 온 일이라는 단서다. 기존 태그 중 직장을 가리키는 것이 없으니 새 태그 '직장'을 만든다. '동호회'에 넣으면 틀린 분류이고, '미분류'에 넣으면 분명한 영역을 버리는 것이다.</why>
</example>
<example>
<capture>카페에서 찍은 라테 사진</capture>
<context>captured_at 2026-03-14 (토) 15:00, existing_tags 영업, 미분류</context>
<output>{"quotes":[],"summary":"카페 라테 사진","tasks":[]}</output>
<why>업무와 명백히 무관하므로 아무것도 만들지 않는다.</why>
</example>
</examples>`;

/*
  지시 6(태그)의 경위 — 원래는 "새 태그는 확실할 때만, 애매하면 '미분류'"였다. 그러자 분야 태그가 없거나
  하나뿐인 계정에서 다른 분야의 일이 전부 '미분류'로 쌓였다(HF-10 QA 보고, HF-11 측정 Luna 0/9).
  HF-10에서 '미분류'뿐인 계정에만 조건부 문단을 실었다가, 두 번째 분야에서 같은 일이 나 기준 자체를
  바꿨다(HF-11): **태그 = 사용자가 속한 조직·활동.** 소속이 뚜렷하면 없는 태그라도 만들고, 개인 볼일은
  '미분류'다. 이 경계가 `06-tagging/01`(건강검진 → '미분류')과 치과 예시를 그대로 살린다.
*/
const INSTRUCTIONS = `<instructions>
1. 캡처에서 판단의 근거가 되는 문구를 먼저 quotes에 원문 그대로 옮기고, 각 문구를 누가 썼는지 speaker에 적어라. 인용을 먼저 해 두면 캡처에 없는 것을 지어내지 않게 되고, 화자를 적어 두면 남의 일을 사용자의 일로 착각하지 않게 된다.
2. 인용을 근거로 사용자가 앞으로 해야 할 일을 찾아라. 여러 개면 각각 태스크로 만들어라.
   - 먼저 누가 사용자인지 가려라. 메신저 캡처에서는 오른쪽에 붙은 말풍선(대개 노란색·파란색, 이름과 프로필 사진이 없다)이 사용자 자신의 메시지이고, 왼쪽에 이름과 함께 나오는 것이 상대의 메시지다. 이걸 뒤바꾸면 남의 일을 사용자의 일로 만들게 된다.
   - 태스크의 근거는 사용자가 스스로 하겠다고 말한 일(speaker가 user인 '~하겠습니다', '~해둘까 합니다' — 조건이 붙어 있어도), 또는 상대나 문서가 사용자에게 요청한 일이다. speaker가 other인 사람이 자기가 하겠다고 한 일은 사용자의 태스크가 아니다.
   - 사용자가 보낸 보고·설명 위주의 긴 메시지에도 약속이 섞여 있을 수 있다. 문단 끝의 '~하겠습니다', '~해 두겠습니다' 같은 문장을 빠뜨리지 말고 각각 태스크로 만들어라. 긴 메시지를 통째로 요약 제목 하나로 뭉개면 사용자가 한 약속이 목록에서 사라진다.
   - 이미 끝난 일은 태스크가 아니다. 대화라면 마지막에 누가 무엇을 말했는지 보고, 요청이 이미 처리되었는지 판단하라.
   - 다른 사람에게 배정된 일은 사용자의 태스크가 아니다.
   - 안내·공지·참고 정보는 번호가 매겨져 있어도 할 일이 아니다.
3. 업무 맥락은 있는데 사용자가 할 일이 보이지 않으면, 캡처를 요약한 제목으로 태스크 하나를 만들고 마감은 비워라. 사용자가 생성 단축키를 누른 것 자체가 기록해 두고 싶다는 뜻이기 때문이다.
   - 요약 제목도 다른 태스크와 같은 할 일체로 쓴다 — '~하기'로 끝맺어라(예: '거래처 견적 요청 응대하기', '분기 보고서 검토 의견 공유하기'). '~건', '~에 대해' 같은 명사형으로 끝내지 마라. 나중에 목록에서 제목만 보고 어떤 캡처였는지 떠올릴 수 있어야 하므로, 캡처에 나온 핵심 대상(문서명·주제·상대)을 구체적으로 넣어라.
   - 상대가 하겠다고 한 말을 제목으로 삼지 마라. 그건 사용자의 일이 아니다.
4. 업무와 명백히 무관한 캡처(풍경, 음식, 셀카 등)면 tasks를 빈 배열로 두어라. 무관한지 애매하면 3번을 따른다.
5. 마감은 context의 captured_at과 timezone을 기준으로 절대 날짜로 바꿔라.
   - '내일', '금요일까지', '다음 주 월요일'은 captured_at의 날짜와 요일에서 센다. 주는 월요일에 시작해 일요일에 끝난다. 한국어의 '다음 주 월요일'은 captured_at이 속한 주의 다음 주 월요일이다.
   - 연도가 없는 날짜(예: 'MAR 3', '4/15')는 captured_at에서 가장 가까운 미래의 그 날짜다.
   - 범위 표현은 허용되는 마지막 날이 마감이다. '이번 주 안에', '주말 중으로'는 그 주 일요일, '오늘 중으로'는 captured_at의 날짜다.
   - 시각이 숫자로 적혀 있을 때만 dueTime을 채워라('오전 8:30' → 08:30). '오전까지', '퇴근 전' 같은 말은 시각이 아니다.
   - 회의·행사·예약처럼 참석하는 일정이면 마감은 그 일정이 시작하는 시각이다. 모이는 시각이나 출발 시각은 준비 단계라 그 일정의 마감이 아니다(원하면 별도 태스크로 만든다).
   - 할 일과 무관한 날짜(파일 보관 기한, 메시지 발신 시각, 행사 기간)는 마감이 아니다.
   - 마감이 드러나지 않으면 추측하지 말고 dueDate와 dueTime을 null로 두어라. 틀린 마감은 빈 마감보다 해롭다.
6. 태그는 사용자가 속한 조직이나 꾸준히 하는 활동(직장, 학교, 동호회, 종교 모임 등) 하나를 가리킨다. 이 일이 어느 조직·활동에서 왔는지 맥락 단서로 추론하라 — 태그 이름이 캡처에 그대로 나오지 않아도 된다. 발신 기관, 프로그램·과정의 성격, 쓰인 용어가 단서다.
   - existing_tags 중 그 조직·활동을 가리키는 태그가 있으면 이름 그대로 골라라.
   - 없으면 그 조직·활동을 가리키는 짧은 새 태그를 만들어라. 다른 조직·활동의 태그에 억지로 넣지 마라 — 틀린 태그는 사용자가 알아채기 어렵다. '미분류'는 영역이 아니므로, 영역이 분명한 일을 '미분류'에 넣지도 마라.
   - 어느 조직·활동에서 온 일인지 단서가 없는 일(병원 예약, 택배 수령 같은 개인 볼일)은 새 태그를 만들지 않고 '미분류'를 쓴다. 볼일마다 태그를 만들면 목록이 흩어진다.
7. 각 태스크의 rationale에는 캡처에서 본 것을 근거로 왜 이 태스크인지 한 문장을 적어라. 사용자가 판단을 검토할 때 읽는다.
8. 태스크마다 open_tasks에 같은 일이 이미 있는지 확인하라. 대상과 해야 할 행동이 같으면 표현이 달라도 같은 일이다 — 그 번호를 duplicateOfKey에 적는다. 같은 주제라도 해야 할 행동이 다르면 새 일이다 — null로 둔다. 같은 일인지 애매하면 null이다. 새 일을 같은 일로 잘못 묶으면 그 할 일이 목록에서 사라지지만, 같은 일을 새로 만들면 사용자가 하나를 지우면 되기 때문이다. duplicateOfKey를 적은 태스크도 title·rationale은 다른 태스크처럼 채운다.
9. title과 summary는 한국어로 짧게 써라. 캡처가 영어여도 고유명사·제품명·파일 형식 같은 원문 표기는 그대로 둔다.
10. 모든 태스크의 title은 '~하기'로 끝나는 할 일체로 써라(예: '자료 정리해서 보내기', '견적서 검토 회신하기'). 사용자가 실행할 태스크(2번)의 title에는 캡처에 나온 대상의 이름(문서·파일·서식·행사·산출물의 이름)을 캡처에 적힌 그대로 넣어라. 요약 태스크(3번)의 제목은 3번 규칙대로 '무엇에 관한 어떤 일이었나'를 먼저 적는다. 여러 동작을 한 태스크로 묶을 때도 대상 이름은 남긴다('견적 준비하기'보다 'A사 견적서 단가표 수정하고 납기 확인하기'). 사용자는 제목만 보고 무엇을 열어야 하는지 알아야 한다.
</instructions>`;

export interface CreatePromptInput {
  capturedAt: string;
  timezone: string;
  existingTags: string[];
  openTasks: OpenTask[];
}

/** 이미지와 함께 실리는 사용자 메시지. 맥락이 위, 지시가 아래다(원칙 A6). */
export function buildCreatePrompt({ capturedAt, timezone, existingTags, openTasks }: CreatePromptInput): string {
  // 제목만 싣는다 — 같은 일인지는 대상과 행동으로 가리고 마감·태그는 판정에 쓰이지 않는다. 한 줄이
  // 짧을수록 입력 토큰과 추론이 줄고, 그것이 곧 지연이다(ROADMAP L-P1-08 §예산 추정).
  const tasks = openTasks.map((task) => `${task.key}. ${task.title}`).join("\n");

  return `<context>
<captured_at>${formatLocal(capturedAt, timezone)}</captured_at>
<timezone>${timezone}</timezone>
<existing_tags>${existingTags.join(", ")}</existing_tags>
<open_tasks>
${tasks || "(미완료 태스크 없음)"}
</open_tasks>
</context>

${EXAMPLES}

${INSTRUCTIONS}`;
}
