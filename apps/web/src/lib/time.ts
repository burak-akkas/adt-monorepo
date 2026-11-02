const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// Relative time such as "just now", "5 minutes ago" or "yesterday". Future times read as "in 2 hours".
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.round((then - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 45) {
    return "just now";
  }
  if (abs < HOUR) {
    return formatter.format(Math.round(seconds / MINUTE), "minute");
  }
  if (abs < DAY) {
    return formatter.format(Math.round(seconds / HOUR), "hour");
  }
  if (abs < MONTH) {
    return formatter.format(Math.round(seconds / DAY), "day");
  }
  if (abs < YEAR) {
    return formatter.format(Math.round(seconds / MONTH), "month");
  }
  return formatter.format(Math.round(seconds / YEAR), "year");
}
