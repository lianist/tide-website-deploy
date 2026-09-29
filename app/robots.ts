import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** 공개 페이지는 랜딩과 개인정보처리방침뿐이다. 나머지는 로그인 뒤라 색인할 것이 없다. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/privacy"], disallow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
