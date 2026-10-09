import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates";
import { computeTrend } from "../src/trends";

const series = (vals: (number | null)[]) => vals.map((value, i) => ({ date: addDays("2026-09-25", i), value }));

describe("computeTrend", () => {
  it("stats over the window and week-over-week delta", () => {
    // last week: 50 x7, this week: 60 x7
    const t = computeTrend(series([...Array(7).fill(50), ...Array(7).fill(60)]), 14);
    expect(t).toMatchObject({ mean: 55, min: 50, max: 60, this_week_mean: 60, last_week_mean: 50, week_over_week_delta: 10, week_over_week_pct: 20 });
    expect(t.series).toHaveLength(14);
  });
  it("window shorter than series still compares weeks from full series", () => {
    const t = computeTrend(series([...Array(7).fill(40), 70, 70, 70, 70, 70, 70, 70]), 7);
    expect(t.series).toHaveLength(7);
    expect(t.mean).toBe(70);
    expect(t.week_over_week_delta).toBe(30);
  });
  it("skips missing days and handles no data", () => {
    const t = computeTrend(series([null, 10, null, 20, null, null, null, null, 30, null, null, null, null, 50]), 14);
    expect(t.days_with_data).toBe(4);
    expect(t.mean).toBe(27.5);
    expect(t.this_week_mean).toBe(40);
    expect(t.last_week_mean).toBe(15);
    const empty = computeTrend(series(Array(14).fill(null)), 14);
    expect(empty).toMatchObject({ mean: null, min: null, max: null, week_over_week_delta: null, week_over_week_pct: null });
  });
});
