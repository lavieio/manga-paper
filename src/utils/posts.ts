import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

/** 发布时间倒序后，date 一定存在的文章类型 */
export type DatedPost = BlogPost & { data: BlogPost["data"] & { date: Date } };

/**
 * slug = 文件名主体（不含目录与扩展名）。目录只作组织用途，不进 URL，
 * 因此全站 slug 必须唯一、合规。
 */
export function getPostSlug(post: BlogPost): string {
  return post.id.split("/").pop() ?? post.id;
}

/** 分类 = frontmatter 显式值 ?? 文章所在一级子目录名 */
export function getCategory(post: BlogPost): string {
  const dir = post.id.split("/");
  return post.data.category ?? (dir.length > 1 ? dir[0] : "");
}

/** 纯数字 slug 会与 /posts/[page] 分页路由撞车；特殊字符会破坏路由 */
const SLUG_FORBIDDEN = /^\d+$|[\\/?#]/;
const TAXONOMY_FORBIDDEN = /[/?#]/;

let printedCategories = false;

/** 构建期硬校验：任何违规直接抛错中止构建 */
function assertValidPost(post: BlogPost): void {
  const slug = getPostSlug(post);
  if (SLUG_FORBIDDEN.test(slug)) {
    throw new Error(
      `[content] 文章 "${post.id}" 的 slug "${slug}" 非法：纯数字会与分页路由冲突，且不允许包含 / \\ ? #`,
    );
  }
  const category = getCategory(post);
  if (!category) {
    throw new Error(
      `[content] 文章 "${post.id}" 缺少分类：根目录文章必须写 category，或移入一级子目录`,
    );
  }
  if (TAXONOMY_FORBIDDEN.test(category)) {
    throw new Error(`[content] 文章 "${post.id}" 的分类 "${category}" 含非法字符 / ? #`);
  }
  for (const tag of post.data.tags) {
    if (TAXONOMY_FORBIDDEN.test(tag)) {
      throw new Error(`[content] 文章 "${post.id}" 的标签 "${tag}" 含非法字符 / ? #`);
    }
  }
}

/** 同一 basename 出现在不同目录会造成 URL 冲突，构建期拦截 */
function assertUniqueSlugs(posts: BlogPost[]): void {
  const seen = new Map<string, string>();
  for (const post of posts) {
    const slug = getPostSlug(post);
    const prev = seen.get(slug);
    if (prev) {
      throw new Error(`[content] slug 冲突："${prev}" 与 "${post.id}" 会生成相同 URL /posts/${slug}`);
    }
    seen.set(slug, post.id);
  }
}

function assertDated(post: BlogPost): asserts post is DatedPost {
  if (!post.data.date) {
    throw new Error(`[content] 发布文章 "${post.id}" 缺少 date（draft 可省略；请提交让钩子注入）`);
  }
}

/** 首次构建时打印 distinct category 清单，笔误一眼可见 */
function printDistinctCategories(posts: BlogPost[]): void {
  if (printedCategories) return;
  printedCategories = true;
  const categories = [...new Set(posts.map(getCategory))].sort();
  console.log(`[content] distinct categories: ${categories.join(" / ")}`);
}

/**
 * 唯一的「已发布文章」入口：排除 draft（私密文章的排除由单独管线处理），
 * 按发布时间倒序。列表/归档/标签/分类/RSS 一律走这里。
 */
export async function getPublishedPosts(): Promise<DatedPost[]> {
  const all = await getCollection("blog");
  all.forEach(assertValidPost);
  assertUniqueSlugs(all);
  const published = all.filter((p) => !p.data.draft);
  published.forEach(assertDated);
  printDistinctCategories(published);
  return published.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** tag/category 进入 URL 的唯一编码方式 */
export function toUrlSegment(value: string): string {
  return encodeURIComponent(value);
}
