import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const LLM_BOUNDARY_MESSAGE =
  "LLM 호출은 `@/lib/llm`만 지난다 — 계측과 프로바이더 교체 지점이 하나여야 한다(docs/03-Architecture.md §설계 결정 4).";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // LLM 단일 choke point. 규칙이 없으면 경계는 지켜지지 않는다 — 누군가 "간 김에" SDK를 직접
    // 부르는 순간 그 호출은 job_logs 계측에서 빠진다. `e2e/llm-adapter.spec.ts`가 이 규칙을 검증한다.
    ignores: ["lib/llm/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "openai", message: LLM_BOUNDARY_MESSAGE }],
          patterns: [{ group: ["openai/*"], message: LLM_BOUNDARY_MESSAGE }],
        },
      ],
    },
  },
  globalIgnores([
    // `**/` 접두가 필요하다. 루트 기준 경로로 적으면 중첩된 산출물
    // (예: .claude/worktrees/*/.next/)을 걸러내지 못한다.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // 워크트리는 이 저장소의 별도 체크아웃이다. 각자의 루트에서 린트된다.
    ".claude/**",
  ]),
]);
