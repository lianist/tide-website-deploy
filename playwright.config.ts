import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Playwright는 Next와 달리 .env.local을 스스로 읽지 않는다. DB 테스트가 Supabase 키를
// 필요로 하므로 여기서 한 번 불러온다. Node 22 내장 기능이라 의존성이 늘지 않는다.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// 배포 환경 대상 실행은 이 변수 하나로 켠다(`PLAYWRIGHT_BASE_URL=https://… npm run test:deployed`).
// 값이 있으면 그 주소를 그대로 치고 dev 서버를 띄우지 않는다 — 띄워 봐야 아무도 치지 않는다.
const REMOTE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
const BASE_URL = REMOTE_BASE_URL ?? "http://localhost:3000";

/**
 * 배포 대상 실행에서 빼는 스펙들.
 *
 * 전부 HTTP를 타지 않고 **이 체크아웃의 소스**를 직접 부른다. 배포본을 향해 돌려도 검증되는
 * 것은 로컬 코드라, 돌리면 "배포된 것을 검증했다"가 거짓이 된다. 로컬 `npm run test`에서는
 * 그대로 돈다.
 */
const LOCAL_ONLY_SPECS = [
  /agent-create\.spec\.ts$/, // runCreateAgent()를 직접 호출한다
  /agent-complete\.spec\.ts$/, // runCompleteAgent()를 직접 호출한다
  /llm-adapter\.spec\.ts$/, // 테스트 안에서 ESLint로 소스 트리의 경계 규칙을 검사한다
  /needs-review\.spec\.ts$/, // countNeedsReview()·markLogHandled()를 직접 호출한다(화면 쪽은 needs-review-ui)
];

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // 배포 환경 대상(`npm run test:deployed`, L-P0-14). PLAYWRIGHT_BASE_URL과 짝으로 쓴다.
    { name: "deployed", use: { ...devices["Desktop Chrome"] }, testIgnore: LOCAL_ONLY_SPECS },
    // 평가 세트(`npm run grade`). 실제 LLM을 케이스마다 부르므로 `npm run test`에서는 돌지 않는다 —
    // 기본 testMatch(*.spec.ts)에 걸리지 않고, test 스크립트가 chromium 프로젝트만 고른다.
    { name: "grade", testMatch: /\.grade\.ts$/ },
  ],
  webServer: REMOTE_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        // 다른 동선(givetest 등)이 이미 dev 서버를 띄워 둔 경우 포트 충돌을 피한다.
        reuseExistingServer: !process.env.CI,
        // Turbopack 콜드 스타트가 기본 60초를 넘길 수 있다.
        timeout: 120_000,
      },
});
