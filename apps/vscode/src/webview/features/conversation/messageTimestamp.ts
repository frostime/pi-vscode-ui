/**
 * Timestamp labels for conversation messages and the turn timing bar.
 * Message timestamps are projection entry times (prompt sent, assistant text
 * finished); malformed persisted entries fall back to 0, which formats to
 * `null` so callers hide the label instead of rendering 1970.
 */

const MS_PER_DAY = 86_400_000;

const timeOfDayFormats = new Map<string, Intl.DateTimeFormat>();
const relativeDayFormats = new Map<string, Intl.RelativeTimeFormat>();

/** `HH:MM` (24h) time-of-day label; also used by the running-turn timing bar. */
export function formatTimeOfDay(timestamp: number, locale?: string): string {
  return cachedFormat(timeOfDayFormats, locale, () => new Intl.DateTimeFormat(locale, {
    // h23 keeps midnight at "00" (hour12:false would render "24" in some locales).
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })).format(timestamp);
}

/**
 * Compact message timestamp in the viewer's calendar: today → `14:32`,
 * previous day → `yesterday 14:32`, earlier in the same year → `9/5 14:32`,
 * otherwise → `2024/9/5 14:32`. Returns `null` for invalid timestamps
 * (projection fallback `0`) so callers can hide the label.
 */
export function formatMessageTimestamp(timestamp: number, now = Date.now(), locale?: string): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const date = new Date(timestamp);
  const time = formatTimeOfDay(timestamp, locale);
  const dayGap = Math.round((startOfDay(now) - startOfDay(timestamp)) / MS_PER_DAY);

  if (dayGap <= 0) return time;
  if (dayGap === 1) return `${relativeDayWord(locale)} ${time}`;
  const yearPrefix = date.getFullYear() === new Date(now).getFullYear() ? "" : `${date.getFullYear()}/`;
  return `${yearPrefix}${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function relativeDayWord(locale?: string): string {
  // numeric:"auto" turns -1 days into the calendar word ("yesterday" / "昨天").
  return cachedFormat(relativeDayFormats, locale, () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }))
    .format(-1, "day");
}

function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Intl construction is costly and message lists re-render often; cache per locale.
function cachedFormat<T>(cache: Map<string, T>, locale: string | undefined, create: () => T): T {
  const key = locale ?? "";
  let format = cache.get(key);
  if (!format) {
    format = create();
    cache.set(key, format);
  }
  return format;
}
