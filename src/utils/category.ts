/** 分类 → 贴纸色映射（plan §4.1 语义色）；未登记的分类统一 blue */
const CATEGORY_COLORS: Record<string, string> = {
  技术: "cyan",
  随笔: "pink",
  摄影: "yellow",
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "blue";
}
