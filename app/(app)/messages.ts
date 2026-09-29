import type { Database } from "@/lib/supabase/database.types";

/**
 * 로그인한 화면들이 **함께** 쓰는 한국어 문구. 한 화면만 쓰는 것은 그 화면 폴더에 둔다.
 *
 * `L-P1-03`에서 `app/(app)/dashboard/messages.ts`에서 올라왔다 — 히스토리가 같은 `source_kind`를
 * 보여 주는데 표를 한 벌 더 만들면 "캡처 (생성)"이 두 곳에서 갈린다.
 */

/**
 * 입력이 어디서 왔는지. **enum 값을 그대로 보여 주지 않는다** — `capture_create`는 사용자의 말이
 * 아니다. 대시보드 패널의 '생성 경로'(`DASH-3`의 7번째 항목)와 히스토리 목록이 같은 표를 쓴다.
 *
 * `capture_complete`로 만들어진 태스크는 없지만(완료 캡처는 태스크를 만들지 않는다) 열거형에
 * 있는 값이라 빠뜨리면 타입이 막는다. 빠뜨린 칸이 런타임에 `undefined`로 새는 것보다 낫다.
 * 작업 로그 쪽에서는 그 값이 실제로 쓰인다 — 완료 캡처의 로그가 곧 그것이다.
 */
export const SOURCE_LABEL: Record<Database["public"]["Enums"]["source_kind"], string> = {
  capture_create: "캡처 (생성)",
  capture_complete: "캡처 (완료)",
  mail: "메일",
  manual: "직접 추가",
};
