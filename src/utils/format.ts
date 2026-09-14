/** 日期展示格式：YYYY-MM-DD，时区固定 Asia/Shanghai（与钩子一致） */
const TIME_ZONE = "Asia/Shanghai";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

export function formatDate(date: Date): string {
  return fmt.format(date);
}
