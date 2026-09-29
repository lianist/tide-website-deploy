/**
 * 요청 본문·쿼리 검증의 공통 조각. 스키마 라이브러리를 들이지 않는다 — 검사할 필드가 한 줌이고,
 * 실패는 전부 `VALIDATION_FAILED` 하나로 모이므로 손으로 쓰는 편이 짧다.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** JSON 객체 본문. 파싱에 실패하거나 객체가 아니면(배열·원시값 포함) null. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 앞뒤 공백을 걷어 낸 비어 있지 않은 문자열. 아니면 null. */
export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
