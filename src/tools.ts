import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cycleDate, dateList, inRange, lastNDays, localDate, localDateTime, padded, parseRange, type Range } from "./dates";
import { formatCycle, formatRecovery, formatSleep, formatWorkout, metersToFeetInches, round } from "./format";
import { computeTrend, type Point } from "./trends";
import { WhoopAuthError, type WhoopClient } from "./whoop";

// ---- data access (live; nothing is cached) ----

async function fetchSleeps(c: WhoopClient, range: Range) {
  const raw = await c.getAll("/v2/activity/sleep", padded(range));
  return raw.filter((s) => inRange(localDate(s.end), range)).sort((a, b) => a.end.localeCompare(b.end));
}

/** Recoveries carry no timestamp of their own beyond created_at; date them by their sleep's wake time. */
async function fetchRecoveries(c: WhoopClient, range: Range) {
  const [raw, sleeps] = await Promise.all([
    c.getAll("/v2/recovery", padded(range)),
    c.getAll("/v2/activity/sleep", padded(range)),
  ]);
  const wake = new Map(sleeps.map((s) => [s.id, s.end as string]));
  return raw
    .map((r) => ({ r, date: localDate(wake.get(r.sleep_id) ?? r.created_at) }))
    .filter(({ date }) => inRange(date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchCycles(c: WhoopClient, range: Range) {
  const raw = await c.getAll("/v2/cycle", padded(range));
  return raw.filter((r) => inRange(cycleDate(r.start), range)).sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchWorkouts(c: WhoopClient, range: Range, sport?: string) {
  const raw = await c.getAll("/v2/activity/workout", { start: range.start.toISOString(), end: range.end.toISOString() });
  const q = sport?.trim().toLowerCase();
  return raw
    .filter((w) => !q || String(w.sport_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const TREND_METRICS = ["recovery", "hrv", "rhr", "sleep_performance", "strain"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

async function trendSeries(c: WhoopClient, metric: TrendMetric, range: Range): Promise<Point[]> {
  const byDate = new Map<string, number>();
  if (metric === "recovery" || metric === "hrv" || metric === "rhr") {
    const key = { recovery: "recovery_score", hrv: "hrv_rmssd_milli", rhr: "resting_heart_rate" }[metric];
    for (const { r, date } of await fetchRecoveries(c, range)) {
      if (r.score_state === "SCORED" && r.score?.[key] != null) byDate.set(date, r.score[key]);
    }
  } else if (metric === "sleep_performance") {
    for (const s of await fetchSleeps(c, range)) {
      if (!s.nap && s.score_state === "SCORED") byDate.set(localDate(s.end), s.score.sleep_performance_percentage);
    }
  } else {
    for (const cy of await fetchCycles(c, range)) {
      if (cy.score_state === "SCORED") byDate.set(cycleDate(cy.start), cy.score.strain);
    }
  }
  return dateList(range.startDate, range.endDate).map((date) => ({ date, value: byDate.get(date) ?? null }));
}

// ---- tool registration ----

const startArg = z
  .string()
  .optional()
  .describe('Start: YYYY-MM-DD, ISO timestamp, "today", "yesterday", "N days ago", or "last N days". Default: last 7 days.');
const endArg = z.string().optional().describe("End (inclusive day if YYYY-MM-DD). Default: now.");
const RO = { readOnlyHint: true, openWorldHint: true } as const;

export function registerTools(server: McpServer, client: () => WhoopClient, origin: () => string | undefined) {
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await fn()) }] };
    } catch (err) {
      const msg =
        err instanceof WhoopAuthError
          ? `${err.message} Reconnect WHOOP at ${origin() ?? "<worker-url>"}/whoop/connect and try again.`
          : `Error: ${err instanceof Error ? err.message : String(err)}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
  const rangeInfo = (r: Range) => ({ from: r.startDate, to: r.endDate, timezone: "America/Chicago" });

  server.registerTool(
    "get_today",
    {
      title: "Today on WHOOP",
      description:
        "Last night's sleep, today's recovery, and the current cycle's strain so far, in one call. Start here for 'how am I doing today'.",
      annotations: RO,
    },
    () =>
      run(async () => {
        const c = client();
        const cycles = await c.get<{ records: any[] }>("/v2/cycle", { limit: 1 });
        const cycle = cycles?.records?.[0];
        if (!cycle) return { note: "No WHOOP cycles found." };
        const [sleep, recovery] = await Promise.all([
          c.get(`/v2/cycle/${cycle.id}/sleep`),
          c.get(`/v2/cycle/${cycle.id}/recovery`),
        ]);
        const wakeDate = sleep ? localDate(sleep.end) : cycleDate(cycle.start);
        return {
          now: localDateTime(new Date()),
          timezone: "America/Chicago",
          sleep: sleep ? formatSleep(sleep) : { note: "No sleep recorded yet for the current cycle." },
          recovery: recovery
            ? formatRecovery(recovery, wakeDate)
            : { note: "No recovery yet for the current cycle (WHOOP calculates it after you wake)." },
          strain: { ...formatCycle(cycle), ...(cycle.end ? {} : { note: "Cycle in progress; strain so far." }) },
        };
      }),
  );

  server.registerTool(
    "get_recovery",
    {
      title: "Recovery",
      description: "Daily recovery: score %, HRV (ms, RMSSD), resting HR, SpO2 %, skin temp. Dated by wake-up day.",
      inputSchema: { start: startArg, end: endArg },
      annotations: RO,
    },
    ({ start, end }) =>
      run(async () => {
        const range = parseRange(start, end);
        const recs = await fetchRecoveries(client(), range);
        return { range: rangeInfo(range), recoveries: recs.map(({ r, date }) => formatRecovery(r, date)) };
      }),
  );

  server.registerTool(
    "get_sleep",
    {
      title: "Sleep",
      description:
        "Sleeps (naps flagged): performance/efficiency/consistency %, stage durations (h:mm), respiratory rate, sleep need vs actual. Dated by wake-up day.",
      inputSchema: { start: startArg, end: endArg },
      annotations: RO,
    },
    ({ start, end }) =>
      run(async () => {
        const range = parseRange(start, end);
        return { range: rangeInfo(range), sleeps: (await fetchSleeps(client(), range)).map(formatSleep) };
      }),
  );

  server.registerTool(
    "get_cycles",
    {
      title: "Daily strain (cycles)",
      description: "Physiological cycles (≈ days): day strain, kcal, avg/max HR.",
      inputSchema: { start: startArg, end: endArg },
      annotations: RO,
    },
    ({ start, end }) =>
      run(async () => {
        const range = parseRange(start, end);
        return { range: rangeInfo(range), cycles: (await fetchCycles(client(), range)).map(formatCycle) };
      }),
  );

  server.registerTool(
    "get_workouts",
    {
      title: "Workouts",
      description: "Workouts: sport, duration, strain, HR zone minutes, kcal, distance. Optional sport name filter.",
      inputSchema: {
        start: startArg,
        end: endArg,
        sport: z.string().optional().describe('Case-insensitive sport name match, e.g. "running".'),
      },
      annotations: RO,
    },
    ({ start, end, sport }) =>
      run(async () => {
        const range = parseRange(start, end);
        return { range: rangeInfo(range), workouts: (await fetchWorkouts(client(), range, sport)).map(formatWorkout) };
      }),
  );

  server.registerTool(
    "get_trends",
    {
      title: "Trends",
      description:
        "Daily series for one metric with mean/min/max and this-week vs last-week delta. Metrics: recovery (%), hrv (ms), rhr (bpm), sleep_performance (%), strain.",
      inputSchema: {
        metric: z.enum(TREND_METRICS),
        days: z.number().int().min(7).max(90).default(30).describe("Window length, 7–90 days."),
      },
      annotations: RO,
    },
    ({ metric, days }) =>
      run(async () => {
        // Always fetch ≥14 days so week-over-week is available even for a 7-day window.
        const range = lastNDays(Math.max(days, 14));
        const series = await trendSeries(client(), metric, range);
        const shown = lastNDays(days);
        return {
          metric,
          range: rangeInfo(shown),
          ...computeTrend(series, days, metric === "hrv" || metric === "strain" ? 1 : 0),
        };
      }),
  );

  server.registerTool(
    "get_profile",
    { title: "Profile", description: "Name, height, weight, and WHOOP-calculated max heart rate.", annotations: RO },
    () =>
      run(async () => {
        const c = client();
        const [profile, body] = await Promise.all([c.get("/v2/user/profile/basic"), c.get("/v2/user/measurement/body")]);
        return {
          name: profile ? `${profile.first_name} ${profile.last_name}` : null,
          height_m: round(body?.height_meter, 2),
          height_ft_in: body?.height_meter ? metersToFeetInches(body.height_meter) : null,
          weight_kg: round(body?.weight_kilogram, 1),
          weight_lb: body?.weight_kilogram ? round(body.weight_kilogram * 2.20462, 1) : null,
          max_hr: body?.max_heart_rate ?? null,
        };
      }),
  );
}
