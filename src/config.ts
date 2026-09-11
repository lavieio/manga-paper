/** 站点全局配置：唯一入口（plan §2）。占位值随时可改。 */
export const site = {
  name: "MangaPaper",
  tagline: "A loose-leaf, comic-paper, monospace blog theme",
  author: "MangaPaper",
} as const;

export type SiteConfig = typeof site;
