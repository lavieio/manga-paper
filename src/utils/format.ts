/** 日期展示格式：YYYY-MM-DD，时区固定 Asia/Shanghai（与钩子一致） */
const TIME_ZONE = "Asia/Shanghai";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

export function formatDate(date: Date): string {
  return fmt.format(date);
}

/** 归档时间轴用：MM-DD */
export function formatMonthDay(date: Date): string {
  return formatDate(date).slice(5);
}

/** 按 Asia/Shanghai 取年份（归档分组用） */
export function getYear(date: Date): number {
  return Number(formatDate(date).slice(0, 4));
}
