import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type DochiClient = SupabaseClient<Database>;

/*
  📮 테스트에서 행을 **직접 심을 때** 밟는 함정 넷 (P1 L4 회고, 2026-09-25).

  뿌리는 하나다 — 에이전트·API·`create_task`를 거치지 않고 `.from(...).insert()`로 심으면,
  프로덕션 경로가 채워 주던 칸을 **테스트가 알아서** 채워야 한다. 빠뜨려도 insert는 대개 성공하고,
  틀린 값은 한참 뒤의 단언에서 엉뚱한 모양으로 터진다. 태스크 한 건이면 `create_task` RPC가 가장
  안전하다(grade 실행기의 `seedTasks`가 그 길이다). 칸을 직접 정해야 할 때만 아래를 지킨다.

  1. **배열 insert는 행들의 칸 집합을 통일한다.** 한 행에만 칸을 적으면 나머지 행에는 기본값이
     아니라 `null`이 들어간다 → 연결 칸(`job_log_id`·`completed_by_job_log_id`)은 **늘 함께**
     적는다. (`L-P1-01`)
  2. **`created_at`만 주면 `updated_at`은 `now()`다.** 두 값이 갈라지면 그 태스크는 "생성 이후
     수정됨"으로 판정돼 되돌리기가 거부된다(`revertable: false`) → 둘을 **같이** 준다. (`L-P1-02`)
  3. **같은 `created_at`이면 순서가 실행마다 다르다.** 작업 로그의 관련 태스크는 `created_at` 다음
     `id`로 가르므로(`lib/api/job-logs.ts`) → 한 캡처가 만든 태스크라도 시각을 **갈라** 심는다. (`L-P1-03`)
  4. **`tasks.source`는 NOT NULL이고 기본값이 없다**(`job_logs.source`도). RPC는 채워 주지만 직접
     insert는 안 채운다 → 빠뜨리면 insert가 실패한다. 경로에 맞는 값을 적는다. (`L-P1-07`)

  새 함정을 밟으면 여기에 다섯 번째로 붙인다 — ROADMAP 루프 절의 📮로만 남기면 다음 세션이 못 찾는다.
*/

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name}이(가) 없습니다. .env.local을 채웠는지 확인하세요 (.env.example 참고).`,
    );
  }
  return value;
}

const SUPABASE_URL = () => requireEnv("NEXT_PUBLIC_SUPABASE_URL");

// 세션을 파일에 쓰지 않는다. 테스트가 한 프로세스에서 사용자 여러 명을 동시에 들고 있어야 하므로
// 클라이언트마다 메모리 안에서만 세션을 유지한다.
const TEST_CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** RLS를 우회하는 관리자 클라이언트. 사용자 생성·삭제와 CASCADE 확인에만 쓴다. */
export function createAdminClient(): DochiClient {
  return createClient<Database>(
    SUPABASE_URL(),
    requireEnv("SUPABASE_SECRET_KEY"),
    TEST_CLIENT_OPTIONS,
  );
}

/** 브라우저와 같은 조건의 클라이언트. RLS가 온전히 적용된다. */
export function createPublicClient(): DochiClient {
  return createClient<Database>(
    SUPABASE_URL(),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    TEST_CLIENT_OPTIONS,
  );
}

/**
 * 테스트용 이메일 한 개. UI로 가입하는 테스트와 관리자 API로 만드는 테스트가 같은 규칙을 쓴다.
 *
 * ⚠️ 관리자 API는 주소 형식 검증을 건너뛰지만 공개 `signUp`은 거치므로, 프로젝트 설정에 따라
 * 이 도메인이 거부될 수 있다. 그때는 이 함수 한 곳만 고치면 된다.
 */
export function newTestEmail(): string {
  return `dochi-test-${crypto.randomUUID()}@dochi.test`;
}

export interface TestUser {
  user: User;
  client: DochiClient;
  email: string;
  /** 로그인 화면을 실제로 지나야 하는 테스트가 쓴다(`signInThroughUi`). */
  password: string;
  /** API를 직접 칠 때 `Authorization: Bearer`에 싣는 토큰. 앱이 보내는 것과 같은 물건이다. */
  accessToken: string;
}

/**
 * 개인정보처리방침 동의를 관리자 권한으로 채운다(HF-06). 가입 트리거가 만든 프로필은 미동의(null)로
 * 시작하므로, 동의 화면을 시험하는 게 아닌 테스트는 이것을 지나야 대시보드·API에 닿는다.
 */
export async function markConsented(admin: DochiClient, userId: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ consented_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`테스트 계정 동의 처리 실패: ${error.message}`);
}

/**
 * 확인된 계정을 하나 만들고 로그인한 클라이언트를 돌려준다.
 * 메일 확인 절차를 태우지 않으려고 관리자 API로 만든다(`email_confirm`).
 *
 * **기본으로 방침 동의까지 마친 계정이다**(HF-06) — 대부분의 테스트는 동의 게이트가 아니라 그 뒤를
 * 본다. 게이트 자체를 볼 때만 `{ consented: false }`.
 */
export async function createSignedInUser(
  admin: DochiClient,
  { consented = true }: { consented?: boolean } = {},
): Promise<TestUser> {
  const email = newTestEmail();
  const password = crypto.randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`테스트 계정 생성 실패: ${createError?.message ?? "user 없음"}`);
  }

  const client = createPublicClient();
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signedIn.session) {
    throw new Error(`테스트 계정 로그인 실패: ${signInError?.message ?? "session 없음"}`);
  }

  if (consented) await markConsented(admin, created.user.id);

  return { user: created.user, client, email, password, accessToken: signedIn.session.access_token };
}

/** auth.users 한 행을 지운다. 이 삭제가 CASCADE로 나머지를 데려가는지가 SET-1의 전제다. */
export async function deleteUser(admin: DochiClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`테스트 계정 삭제 실패: ${error.message}`);
  }
}

/**
 * 메일을 보내지 않고 링크 속 토큰만 만든다.
 *
 * 메일함 없이 "링크를 눌렀다"를 재현하는 수단이다. 실제 발송을 타면 SMTP 설정과 시간당 발송
 * 제한에 묶여 테스트가 환경에 의존하게 된다. 여기서 얻은 해시를
 * `/auth/callback?token_hash=…&type=…`에 실으면 메일 템플릿이 만드는 링크와 같은 요청이 된다.
 */
export async function generateEmailToken(
  admin: DochiClient,
  type: "signup" | "recovery",
  email: string,
  password?: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink(
    type === "signup"
      ? { type: "signup", email, password: password ?? crypto.randomUUID() }
      : { type: "recovery", email },
  );
  if (error || !data.properties) {
    throw new Error(`${type} 링크 생성 실패: ${error?.message ?? "properties 없음"}`);
  }
  return data.properties.hashed_token;
}

/**
 * 이메일로 계정을 찾아 지운다. 화면으로 가입한 계정은 테스트가 id를 모르기 때문에 필요하다.
 * 찾지 못하면 조용히 지나간다 — 뒷정리는 실패해도 테스트 결과를 바꾸지 않아야 한다.
 */
export async function deleteUserByEmail(admin: DochiClient, email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) return;

  const found = data.users.find((user) => user.email === email);
  if (found) await deleteUser(admin, found.id);
}
