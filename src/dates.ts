// All "calendar" reasoning happens in America/Chicago. WHOOP takes/returns UTC instants.

export const TZ = "America/Chicago";
const DAY_MS = 86_400_000;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(d)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Chicago calendar date (YYYY-MM-DD) of an instant. */
export function localDate(d: Date | string): string {
  const p = parts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Chicago wall-clock "YYYY-MM-DD HH:MM" of an instant. */
export function localDateTime(d: Date | string): string {
  const p = parts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (ms) of Chicago wall time from UTC at the given instant, e.g. -5h during CDT. */
function offsetMs(d: Date): number {
  const p = parts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The UTC instant of 00:00 Chicago time on the given date (DST-aware). */
export function chicagoMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess));
  const off2 = offsetMs(new Date(t));
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface Range {
  start: Date; // inclusive
  end: Date; // exclusive
  startDate: string; // Chicago date of start
  endDate: string; // Chicago date of the last instant in range
}

interface Span {
  from: Date;
  to: Date;
  /** Relative phrases ("today", "last 7 days") define a full window on their own. */
  relative: boolean;
}

function parsePhrase(input: string, now: Date): Span {
  const s = input.trim().toLowerCase();
  const today = localDate(now);
  if (s === "today") return { from: chicagoMidnight(today), to: now, relative: true };
  if (s === "yesterday") {
    return { from: chicagoMidnight(addDays(today, -1)), to: chicagoMidnight(today), relative: true };
  }
  if (s === "last week" || s === "past week") return parsePhrase("last 7 days", now);
  if (s === "last month" || s === "past month") return parsePhrase("last 30 days", now);
  let m = s.match(/^(?:last|past)\s+(\d{1,3})\s+days?$/);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) throw new Error(`Invalid range "${input}"`);
    return { from: chicagoMidnight(addDays(today, -(n - 1))), to: now, relative: true };
  }
  m = s.match(/^(\d{1,3})\s+days?\s+ago$/);
  if (m) {
    const d = addDays(today, -Number(m[1]));
    return { from: chicagoMidnight(d), to: chicagoMidnight(addDays(d, 1)), relative: true };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (Number.isNaN(Date.parse(s))) throw new Error(`Invalid date "${input}"`);
    return { from: chicagoMidnight(s), to: chicagoMidnight(addDays(s, 1)), relative: false };
  }
  const t = Date.parse(input.trim());
  if (/^\d{4}-\d{2}-\d{2}t/i.test(s) && !Number.isNaN(t)) {
    return { from: new Date(t), to: new Date(t), relative: false };
  }
  throw new Error(
    `Unrecognized date "${input}". Use YYYY-MM-DD, an ISO timestamp, "today", "yesterday", "N days ago", or "last N days".`,
  );
}

/**
 * Resolve optional start/end inputs into a concrete range.
 * - neither: last 7 days (through now)
 * - start only: a relative phrase is its own window ("yesterday" = just yesterday);
 *   a date/timestamp means "from then until now"
 * - end only: the 7 days ending on that date
 * - a bare date used as `end` is inclusive of that whole day
 */
export function parseRange(start?: string, end?: string, now = new Date()): Range {
  const s = start ? parsePhrase(start, now) : undefined;
  const e = end ? parsePhrase(end, now) : undefined;

  let from: Date;
  let to: Date;
  if (!s && !e) {
    const w = parsePhrase("last 7 days", now);
    from = w.from;
    to = w.to;
  } else if (s && !e) {
    from = s.from;
    to = s.relative ? s.to : now;
  } else if (!s && e) {
    to = e.to;
    from = chicagoMidnight(addDays(localDate(new Date(to.getTime() - 1)), -6));
  } else {
    from = s!.from;
    to = e!.to;
  }
  if (to.getTime() > now.getTime()) to = now;
  if (from.getTime() >= to.getTime()) throw new Error("Start must be before end (and not in the future).");
  return {
    start: from,
    end: to,
    startDate: localDate(from),
    endDate: localDate(new Date(to.getTime() - 1)),
  };
}

/** Range covering the last `days` Chicago calendar days, through now. */
export function lastNDays(days: number, now = new Date()): Range {
  return parseRange(`last ${days} days`, undefined, now);
}

/**
 * WHOOP filters collections by record start. Sleeps/cycles/recoveries that belong to a day
 * begin the evening before, so we query a padded window and filter by assigned date.
 */
export function padded(range: Range): { start: string; end: string } {
  return {
    start: new Date(range.start.getTime() - DAY_MS).toISOString(),
    end: range.end.toISOString(),
  };
}

export function inRange(date: string, range: Range): boolean {
  return date >= range.startDate && date <= range.endDate;
}

/**
 * The day a physiological cycle "belongs to". Cycles start at sleep onset (usually the
 * evening before), so shift by 12h: 11pm Oct 7 → Oct 8, 1am Oct 8 → Oct 8.
 */
export function cycleDate(start: string): string {
  return localDate(new Date(new Date(start).getTime() + 12 * 3_600_000));
}
