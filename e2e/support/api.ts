import { expect, type APIResponse } from "@playwright/test";

/** API spec들이 함께 쓰는 조각. 앱이 보내는 요청과 같은 모양을 만든다. */

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * `POST /api/v1/captures`의 `data`. 계약은 `docs/04-API-Contract.md` §캡처.
 *
 * 앱이 이 한 덩어리로 알림을 전부 구성하므로(`API-3`), 모양이 어긋나면 알림이 깨진다.
 * 캡처를 보내는 스펙이 둘 이상이라 여기 둔다.
 */
export interface CaptureData {
  jobLogId: string;
  outcome: "created" | "completed" | "failed";
  created: {
    id: string;
    title: string;
    dueAt: string | null;
    dueHasTime: boolean;
    tags: string[];
    rationale: string;
  }[];
  completed: { id: string; title: string } | null;
  duplicates: { id: string; title: string }[];
  failure: { code: string; message: string } | null;
}

export async function bodyOf(response: APIResponse): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** 성공 봉투를 벗겨 `data`를 돌려준다. 봉투가 `{data}` 한 키뿐인지도 함께 본다. */
export async function dataOf<T = Record<string, unknown>>(response: APIResponse): Promise<T> {
  expect(response.status(), await response.text()).toBe(200);
  const body = await bodyOf(response);
  expect(Object.keys(body)).toEqual(["data"]);
  return body.data as T;
}

/** 실패 봉투가 계약대로인지 한 자리에서 본다 — 모양이 어긋나면 앱의 분기가 통째로 깨진다. */
export async function expectFailure(
  response: APIResponse,
  code: string,
  status: number,
): Promise<void> {
  expect(response.status()).toBe(status);

  const body = await bodyOf(response);
  expect(Object.keys(body)).toEqual(["error"]);

  const error = body.error as { code: string; message: string };
  expect(error.code).toBe(code);
  // message는 사람이 읽고 앱이 알림 본문에 그대로 쓴다. 비어 있으면 알림이 빈칸이 된다.
  expect(error.message.length).toBeGreaterThan(0);
}
