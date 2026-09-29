import { formatLocal } from "@/lib/time";

/**
 * 완료 캡처 프롬프트 — `AGT-6`, `AGT-7`. 원칙은 `docs/07-Prompt-Principles.md`, 골격은 같은 문서 §C.
 *
 * **고칠 때는 `npm run grade -- complete`로 평가 세트를 다시 돌린다.** 케이스와 심어 둔 함정은
 * `e2e/fixtures/captures/README.md`에 있다. 예시는 평가 세트와 다른 도메인으로 쓴다 — 누수 가드
 * (`e2e/agent-complete.spec.ts`)가 세트의 태스크 제목과 태그가 여기 없는지 확인한다.
 */

/** 모델이 내는 모양. 스키마(`buildCompleteSchema`)와 1:1이다 — **신뢰도 칸이 없다**(결정 기록 2). */
export interface CompleteOutput {
  quotes: { speaker: "user" | "other" | "document"; text: string }[];
  summary: string;
  rationale: string;
  /** 후보 목록의 번호. 닫을 것이 없으면 null(`AGT-7`). */
  taskKey: string | null;
}

/** 모델에게 보여 줄 미완료 태스크 한 건. `key`는 이 요청 안에서만 쓰는 번호다. */
export interface CompleteCandidate {
  key: string;
  title: string;
  dueAt: string | null;
  dueHasTime: boolean;
  tags: string[];
}

/**
 * 후보를 **요청마다 enum으로 박는다.** 모델은 목록에 없는 태스크를 고를 수 없고, UUID 대신 짧은
 * 번호라 토큰도 적다. 번호 → id 매핑은 서버가 쥔다(`docs/03-Architecture.md` §설계 결정 16).
 * 후보가 없으면 null만 허용한다 — 빈 enum은 스키마로 성립하지 않는다.
 */
export function buildCompleteSchema(keys: string[]) {
  const taskKey =
    keys.length > 0
      ? {
          anyOf: [{ type: "string", enum: keys }, { type: "null" }],
          description: "완료된 태스크의 번호. 캡처가 끝냈다고 보여 주는 태스크가 없으면 null",
        }
      : { type: "null", description: "미완료 태스크가 없으므로 항상 null" };

  return {
    name: "capture_complete",
    jsonSchema: {
      type: "object",
      properties: {
        quotes: {
          type: "array",
          description: "완료 여부를 판단한 근거가 되는 캡처 속 문구와 그 말을 한 쪽. 판단하기 전에 먼저 채운다.",
          items: {
            type: "object",
            properties: {
              // 생성과 같은 이유로 화자를 칸으로 강제한다 — 남이 끝낸 일을 사용자의 완료로 읽는 것이
              // 완료 캡처의 가장 위험한 오판이다(complete/03).
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
          description: "캡처가 무엇인지 한국어 한 줄 요약. 닫을 태스크가 없어도 채운다(작업 로그에 남는다).",
        },
        rationale: {
          type: "string",
          description: "캡처에서 본 것을 근거로 왜 이 태스크가 끝났는지, 또는 왜 닫을 것이 없는지 한 문장",
        },
        taskKey,
      },
      required: ["quotes", "summary", "rationale", "taskKey"],
      additionalProperties: false,
    },
  };
}

export const COMPLETE_SYSTEM = `당신은 사용자의 화면 캡처를 보고, 사용자의 미완료 할 일 중 무엇이 끝났는지 판단하는 분석기다.
사용자는 완료 단축키를 눌러 이 캡처를 보냈다. 결과는 확인 없이 곧바로 그 할 일을 완료로 바꾸고, 사용자가 나중에 고친다.
그래서 사용자에게 질문하지 않는다. 판단이 갈리면 가장 그럴듯한 쪽 하나로 확정한다.`;

const EXAMPLES = `<examples>
<example>
<capture>보낸 메일: "김 과장님, 요청하신 견적서 수정본 첨부드립니다." 첨부 1개(견적서_v2.xlsx)</capture>
<context>open_tasks 1. A사 견적서 수정해서 보내기 (마감 2026-03-11) / 2. 월간 영업 보고서 작성 (마감 2026-03-11)</context>
<output>{"quotes":[{"speaker":"user","text":"요청하신 견적서 수정본 첨부드립니다."}],"summary":"견적서 수정본을 첨부해 보낸 메일","rationale":"사용자가 견적서 수정본을 보냈으므로 견적서 태스크가 끝났다.","taskKey":"1"}</output>
<why>두 태스크의 마감이 같다. 마감이 아니라 캡처의 내용이 어느 태스크와 맞는지로 고른다.</why>
</example>
<example>
<capture>보낸 메일: "계약서 서명본, 사업자등록증, 통장 사본 함께 보내드립니다." 첨부 3개</capture>
<context>open_tasks 1. 공급 계약서 서명해서 회신 / 2. 사업자등록증 사본 제출 / 3. 대금 수령 통장 사본 제출 / 4. 분기 회식 장소 예약</context>
<output>{"quotes":[{"speaker":"user","text":"계약서 서명본, 사업자등록증, 통장 사본 함께 보내드립니다."}],"summary":"계약 서류 세 가지를 한 번에 보낸 메일","rationale":"메일의 첫 번째이자 중심 서류가 계약서 서명본이다.","taskKey":"1"}</output>
<why>캡처가 여러 태스크에 걸려도 하나만 고른다. 가장 직접적으로 끝난 것 하나를 닫고, 나머지는 사용자가 직접 닫는다.</why>
</example>
<example>
<capture>동료의 메신저: "보내주신 회의록 잘 받았습니다!"</capture>
<context>open_tasks 1. 주간 회의록 정리해서 공유 / 2. 거래처 방문 일정 잡기</context>
<output>{"quotes":[{"speaker":"other","text":"보내주신 회의록 잘 받았습니다!"}],"summary":"동료가 회의록 수신을 확인한 메신저","rationale":"상대가 사용자가 보낸 회의록을 받았다고 확인했다.","taskKey":"1"}</output>
<why>말한 사람은 상대지만, 확인해 준 것은 사용자의 일이 끝났다는 사실이다.</why>
</example>
<example>
<capture>공지 메일: "사내 메신저가 새 버전으로 업데이트되었습니다. 파일 전송 기능이 개선되었습니다."</capture>
<context>open_tasks 1. 주간 회의록 정리해서 공유 / 2. 거래처 방문 일정 잡기</context>
<output>{"quotes":[{"speaker":"document","text":"사내 메신저가 새 버전으로 업데이트되었습니다."}],"summary":"사내 메신저 업데이트 공지 메일","rationale":"다른 사람이 끝낸 일을 알리는 공지로, 사용자의 태스크 중 끝난 것이 없다.","taskKey":null}</output>
<why>'완료되었습니다' 같은 말이 있어도 남이 자기 일을 끝냈다는 소식은 사용자의 완료가 아니다. 억지로 하나를 닫지 않는다.</why>
</example>
</examples>`;

const INSTRUCTIONS = `<instructions>
1. 캡처에서 무엇이 끝났는지 보여 주는 문구를 먼저 quotes에 원문 그대로 옮기고, 누가 썼는지 speaker에 적어라. 메신저에서는 오른쪽에 붙은 말풍선(대개 노란색·파란색, 이름과 프로필 사진이 없다)이 사용자 자신의 메시지이고, 왼쪽에 이름과 함께 나오는 것이 상대의 메시지다. 보낸 메일은 사용자가 쓴 것이다.
2. 캡처가 open_tasks 중 하나가 끝났다는 증거인지 판단하라. 증거는 사용자의 일이 끝났다는 것이어야 한다.
   - 사용자가 보내거나 제출하거나 답했다는 흔적(보낸 메일, '~완료했습니다', '~보내드립니다'), 또는 상대가 사용자의 것을 받았다고 확인해 준 말이 증거다.
   - 다른 사람이나 서비스가 자기 일을 끝냈다는 소식(업데이트 공지, 출시 안내, 남의 작업 보고)은 '완료', '되었습니다' 같은 말이 있어도 사용자의 완료가 아니다.
   - 앞으로 하겠다는 말이나 요청은 아직 끝난 일이 아니다.
3. 끝난 태스크를 고를 때는 캡처의 내용(대상·문서·행동)이 태스크 제목과 맞는지로 고른다. 마감이 가깝다는 이유로 고르지 마라 — 마감은 무엇이 끝났는지와 상관이 없다.
4. 캡처가 여러 태스크에 걸려도 taskKey는 하나만 고른다. 가장 직접적으로 끝났다고 보이는 것 하나다. 나머지는 사용자가 직접 닫는다.
5. 끝났다고 볼 만한 태스크가 없으면 taskKey를 null로 두어라. 엉뚱한 태스크를 완료로 바꾸면 사용자가 그 할 일을 목록에서 놓치게 되므로, 억지로 고르는 것은 아무것도 안 바꾸는 것보다 해롭다.
6. rationale에는 캡처에서 본 것을 근거로 한 문장을 적고, summary에는 캡처가 무엇인지 한 줄로 적어라. 둘 다 한국어로 짧게 쓴다.
</instructions>`;

export interface CompletePromptInput {
  capturedAt: string;
  timezone: string;
  candidates: CompleteCandidate[];
}

/** 날짜만 있는 마감은 시각을 숨긴다 — 23:59:59는 사용자가 적은 시각이 아니다(설계 결정 14). */
function formatDue(candidate: CompleteCandidate, timezone: string): string {
  if (!candidate.dueAt) return "마감 없음";
  const local = formatLocal(candidate.dueAt, timezone);
  return `마감 ${candidate.dueHasTime ? local : local.slice(0, -" 00:00".length)}`;
}

/** 이미지와 함께 실리는 사용자 메시지. 맥락이 위, 지시가 아래다(원칙 A6). */
export function buildCompletePrompt({ capturedAt, timezone, candidates }: CompletePromptInput): string {
  const tasks = candidates
    .map((c) => `${c.key}. ${c.title} (${formatDue(c, timezone)}; 태그 ${c.tags.join(", ") || "없음"})`)
    .join("\n");

  return `<context>
<captured_at>${formatLocal(capturedAt, timezone)}</captured_at>
<timezone>${timezone}</timezone>
<open_tasks>
${tasks || "(미완료 태스크 없음)"}
</open_tasks>
</context>

${EXAMPLES}

${INSTRUCTIONS}`;
}
