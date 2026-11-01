import { DISPLAY_TIMEZONE } from './config.js';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 取日期在 DISPLAY_TIMEZONE 时区下的各个部分。
 * Get the date parts of a date in DISPLAY_TIMEZONE.
 * @param d - 日期 / Date
 * @returns 年月日时分 / Year, month, day, hour, minute
 */
function parts(d: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const map = Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));
  return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute };
}

/**
 * 把日期格式化为 DISPLAY_TIMEZONE 时区的 "YYYY-MM-DD"。
 * Format a date as "YYYY-MM-DD" in DISPLAY_TIMEZONE.
 * @param d - 日期 / Date
 * @returns 格式化字符串 / Formatted string
 */
export function formatDate(d: Date): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * 把日期格式化为 DISPLAY_TIMEZONE 时区的 "YYYY-MM-DD HH:mm"。
 * Format a date as "YYYY-MM-DD HH:mm" in DISPLAY_TIMEZONE.
 * @param d - 日期 / Date
 * @returns 格式化字符串 / Formatted string
 */
export function formatDateTime(d: Date): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
