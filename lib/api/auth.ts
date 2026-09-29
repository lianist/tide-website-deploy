import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

import { fail } from "./envelope";

/**
 * Route Handler 인증 — `docs/04-API-Contract.md` §인증(`API-4`)의 구현.
 *
 * **`proxy.ts`(구 `middleware.ts`)가 아니라 핸들러 래퍼다.** Next 16 문서는 proxy가 CDN에
 * 배포될 수 있으니 공유 모듈이나 전역에 기대지 말라고 못 박는다. 인증은 데이터에 손대기
 * 직전에서 확인해야 하고, 그 자리에서 사용자 스코프 클라이언트까지 함께 건네야 하므로
 * 검증을 요청 경계가 아니라 핸들러 경계에 둔다.
 */

/** 검증을 통과한 요청이 핸들러에게 건네받는 것. */
export interface AuthContext {
  /** 토큰 주인의 id(`sub`). RLS가 보는 `auth.uid()`와 같은 값이다. */
  userId: string;
  /** 익명 로그인을 쓰지 않으므로 사실상 항상 있지만, 클레임상 선택 항목이라 null을 연다. */
  email: string | null;
  /**
   * 요청자의 토큰을 달고 있는 클라이언트. 모든 쿼리가 RLS 아래에서 돈다.
   *
   * 남의 행은 에러가 아니라 **빈 결과**로 돌아온다(`e2e/rls.spec.ts`가 확인한 성질). 덕분에
   * "남의 자원은 403이 아니라 404"가 핸들러의 분기가 아니라 DB의 성질로 성립한다 — 핸들러는
   * 소유권을 비교하지 않고, 비교하지 않으니 비교를 빠뜨릴 수도 없다.
   */
  supabase: SupabaseClient<Database>;
}

const BEARER_PREFIX = "Bearer ";

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) return null;

  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * 토큰이 없든 만료됐든 위조됐든 **같은 응답**을 낸다. 어느 쪽인지 알려 주면 공격자에게
 * 토큰이 실재하는지를 흘리게 된다. 앱은 이 코드 하나만 보고 리프레시를 시도한다.
 */
function unauthorized(): Response {
  return fail("UNAUTHORIZED", "로그인이 필요합니다.");
}

export interface WithAuthOptions {
  /**
   * 개인정보처리방침에 동의한 계정만 통과시킨다(HF-06, 기본값). 동의 전이면 `403 CONSENT_REQUIRED`.
   *
   * `false`는 동의를 받으러 가는 길에 필요한 두 경로만 쓴다 — `GET /api/v1/me`(누구로 붙어 있나)와
   * `POST /api/v1/web-session`(앱이 웹뷰를 열어 `/consent`로 보내는 통로). 여기까지 막으면 앱이
   * 동의 화면에 닿을 길이 없다.
   */
  requireConsent?: boolean;
}

/**
 * 핸들러를 감싸 `Authorization: Bearer <token>`을 검증하고 `AuthContext`를 합쳐 넘긴다.
 * 검증에 실패하면 핸들러는 아예 실행되지 않는다.
 *
 * `Context`는 Next가 주는 두 번째 인자다. 동적 구간이 있으면 호출부가
 * `withAuth<RouteContext<"/api/v1/tasks/[id]">>(...)`처럼 박아 `params`를 타입으로 받는다.
 */
export function withAuth<Context extends object = object>(
  handler: (request: NextRequest, context: Context & AuthContext) => Promise<Response>,
  { requireConsent = true }: WithAuthOptions = {},
): (request: NextRequest, context: Context) => Promise<Response> {
  return async (request, context) => {
    const token = readBearerToken(request);
    if (!token) return unauthorized();

    const { url, publishableKey } = supabaseEnv();
    const supabase = createClient<Database>(url, publishableKey, {
      // 서버에는 유지할 세션이 없다. 요청이 들고 온 토큰 한 장이 전부다.
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // getClaims()(서명만 로컬 검증)가 아니라 getUser()로 Auth 서버에 묻는다 — 서명이 멀쩡해도
    // 사용자가 지워졌거나 세션이 폐기됐으면 여기서 401이 된다. 앱은 401에만 반응하므로, 로컬
    // 검증으로는 탈퇴한 계정의 토큰을 잔여 수명 동안 붙들고 있었다(HF-05). 대가는 요청마다
    // Auth 왕복 한 번 — 실측과 경위는 docs/03-Architecture.md §설계 결정 9.
    // 동의 여부는 요청자 토큰으로 RLS 아래에서 읽는다. getUser와 서로 기다릴 이유가 없어 나란히
    // 보낸다 — 지연은 둘 중 느린 쪽 하나다. 토큰이 무효면 이 조회는 행 없이 끝나고 버려진다.
    const [{ data, error }, consent] = await Promise.all([
      supabase.auth.getUser(token),
      requireConsent
        ? supabase.from("profiles").select("consented_at").maybeSingle()
        : Promise.resolve(null),
    ]);
    if (!data.user) {
      // Auth 서버 자체의 실패(5xx·네트워크)를 401로 합치면 앱이 멀쩡한 사용자를 로그아웃시킨다.
      const rejected = error?.status !== undefined && error.status >= 400 && error.status < 500;
      if (rejected) return unauthorized();
      console.error("[withAuth] Auth 서버 실패:", error?.code, error?.message);
      return fail("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");
    }

    if (consent) {
      if (consent.error) {
        console.error("[withAuth] 동의 조회 실패:", consent.error.code, consent.error.message);
        return fail("INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");
      }
      if (!consent.data?.consented_at) {
        return fail(
          "CONSENT_REQUIRED",
          "개인정보처리방침 동의가 필요합니다. Tide 대시보드를 열어 동의해 주세요.",
        );
      }
    }

    const { id, email } = data.user;
    return handler(request, {
      ...context,
      userId: id,
      email: email ?? null,
      supabase,
    });
  };
}
