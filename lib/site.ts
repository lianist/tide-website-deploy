/**
 * 사이트의 공개 주소. 사이트맵·robots·OG 이미지의 절대 주소가 여기서 나온다.
 *
 * Vercel이 넣어 주는 `VERCEL_PROJECT_PRODUCTION_URL`은 프로젝트의 **대표 프로덕션 도메인**이다 —
 * 사용자 도메인(`tide-ai.cloud`)을 붙이고 대표로 정하면 코드 수정 없이 그쪽으로 바뀐다.
 */
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";
