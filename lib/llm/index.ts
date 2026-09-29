/**
 * LLM 호출의 단일 choke point — `docs/03-Architecture.md` §설계 결정 4.
 *
 * 호출부는 `@/lib/llm`만 import 한다. 프로바이더를 바꿀 때 고치는 곳은 아래 `export` 한 줄과
 * 구현 파일뿐이고, 호출부는 건드리지 않는다.
 */
export { analyzeImage } from "./openai";
export {
  LlmError,
  type AnalyzeImageRequest,
  type AnalyzeImageResult,
  type LlmUsage,
} from "./types";
