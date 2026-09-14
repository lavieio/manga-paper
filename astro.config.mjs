import { defineConfig } from "astro/config";

// 站点根 URL 唯一真源是 env SITE_URL；占位值仅兜底，上线前必须配置。
// 驱动 canonical URL / sitemap / RSS 链接。
export default defineConfig({
  output: "static",
  site: process.env.SITE_URL ?? "https://your-domain.com",
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark-dimmed" },
    },
  },
});
