import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * 博客内容模型（plan §5）。
 * 草稿可省略 date；发布文章必须有 date（钩子会注入，注入失败即报错）。
 * category 为自由字符串，不写死枚举。
 */
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // 草稿允许无 date；发布文章若无 date 将在 getPublishedPosts() 报构建错误
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    // 可省略：缺省取文章所在一级子目录名（tech/ → tech）；根目录文件必须显式填写
    category: z.string().optional(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    private: z.boolean().default(false),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
  }),
});

export const collections = { blog };
