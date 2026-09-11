/** 阅读时长估算（plan §5）：中文 ÷450 字/分，英文 ÷200 词/分，合计向上取整、保底 1 分钟 */
const CJK_CHARS_PER_MIN = 450;
const EN_WORDS_PER_MIN = 200;
const MIN_MINUTES = 1;

const CODE_BLOCK = /```[\s\S]*?```|`[^`]*`/g;
const HTML_TAG = /<[^>]+>/g;
const CJK_CHAR = /[\u3000-\u9FFF\uF900-\uFAFF]/g;
const WORD = /[A-Za-z0-9_'-]+/g;

export function estimateReadTime(markdown: string): number {
  const text = markdown.replace(CODE_BLOCK, " ").replace(HTML_TAG, " ");
  const cjkCount = (text.match(CJK_CHAR) ?? []).length;
  const wordCount = (text.replace(CJK_CHAR, " ").match(WORD) ?? []).length;
  const minutes = cjkCount / CJK_CHARS_PER_MIN + wordCount / EN_WORDS_PER_MIN;
  return Math.max(MIN_MINUTES, Math.ceil(minutes));
}
