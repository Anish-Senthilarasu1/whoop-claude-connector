import { round } from "./format";

export interface Point {
  date: string;
  value: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * `series` must be one point per day, ascending, ending today. Stats cover the last
 * `days` points; week-over-week compares the final 7 points with the 7 before them.
 */
export function computeTrend(series: Point[], days: number, digits = 1) {
  const window = series.slice(-days);
  const vals = window.map((p) => p.value).filter((v): v is number => v != null);
  const valuesOf = (pts: Point[]) => pts.map((p) => p.value).filter((v): v is number => v != null);
  const thisWeek = mean(valuesOf(series.slice(-7)));
  const lastWeek = mean(valuesOf(series.slice(-14, -7)));
  const delta = thisWeek != null && lastWeek != null ? thisWeek - lastWeek : null;
  return {
    series: window.map((p) => ({ date: p.date, value: round(p.value, digits) })),
    days_with_data: vals.length,
    mean: round(mean(vals), digits),
    min: vals.length ? round(Math.min(...vals), digits) : null,
    max: vals.length ? round(Math.max(...vals), digits) : null,
    this_week_mean: round(thisWeek, digits),
    last_week_mean: round(lastWeek, digits),
    week_over_week_delta: round(delta, digits),
    week_over_week_pct: delta != null && lastWeek ? round((delta / lastWeek) * 100, 1) : null,
  };
}
