// Turn raw WHOOP v2 records into compact, human-readable objects.
import { cycleDate, localDate, localDateTime } from "./dates";

export const round = (x: number | null | undefined, digits = 1): number | null =>
  x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** digits) / 10 ** digits;

/** Milliseconds → "h:mm" (rounded to the nearest minute). */
export function hm(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const sign = ms < 0 ? "-" : "";
  const totalMin = Math.round(Math.abs(ms) / 60_000);
  return `${sign}${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
}

export const kjToKcal = (kj: number | null | undefined) => (kj == null ? null : Math.round(kj / 4.184));
export const cToF = (c: number | null | undefined) => (c == null ? null : round((c * 9) / 5 + 32, 1));
export const minutes = (ms: number | null | undefined) => (ms == null ? null : Math.round(ms / 60_000));

export function metersToFeetInches(m: number): string {
  const totalIn = Math.round(m / 0.0254);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

const STATE_NOTES: Record<string, string> = {
  PENDING_SCORE: "PENDING_SCORE: WHOOP hasn't finished scoring this yet; check back later.",
  UNSCORABLE: "UNSCORABLE: WHOOP could not score this (e.g. not enough data recorded).",
};

/** For non-scored records, returns the explicit state note; otherwise undefined. */
function unscored(r: { score_state: string; score?: unknown }) {
  if (r.score_state === "SCORED" && r.score) return undefined;
  return { score_state: r.score_state, note: STATE_NOTES[r.score_state] ?? `score_state=${r.score_state}` };
}

export function formatRecovery(r: any, date: string) {
  const base = { date, cycle_id: r.cycle_id };
  const u = unscored(r);
  if (u) return { ...base, ...u };
  const s = r.score;
  return {
    ...base,
    score_state: "SCORED",
    recovery_pct: round(s.recovery_score, 0),
    hrv_ms: round(s.hrv_rmssd_milli, 1),
    resting_hr: round(s.resting_heart_rate, 0),
    spo2_pct: round(s.spo2_percentage, 1),
    skin_temp_c: round(s.skin_temp_celsius, 2),
    skin_temp_f: cToF(s.skin_temp_celsius),
    ...(s.user_calibrating ? { calibrating: true } : {}),
  };
}

export function formatSleep(r: any) {
  const base = {
    date: localDate(r.end),
    start: localDateTime(r.start),
    end: localDateTime(r.end),
    nap: r.nap,
  };
  const u = unscored(r);
  if (u) return { ...base, ...u };
  const s = r.score;
  const st = s.stage_summary;
  const asleep = st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli;
  const n = s.sleep_needed;
  const need =
    n.baseline_milli + n.need_from_sleep_debt_milli + n.need_from_recent_strain_milli + n.need_from_recent_nap_milli;
  return {
    ...base,
    score_state: "SCORED",
    performance_pct: round(s.sleep_performance_percentage, 0),
    efficiency_pct: round(s.sleep_efficiency_percentage, 0),
    consistency_pct: round(s.sleep_consistency_percentage, 0),
    respiratory_rate: round(s.respiratory_rate, 1),
    in_bed: hm(st.total_in_bed_time_milli),
    asleep: hm(asleep),
    awake: hm(st.total_awake_time_milli),
    light: hm(st.total_light_sleep_time_milli),
    deep_sws: hm(st.total_slow_wave_sleep_time_milli),
    rem: hm(st.total_rem_sleep_time_milli),
    sleep_need: hm(need),
    need_vs_actual: hm(asleep - need),
    need_breakdown: {
      baseline: hm(n.baseline_milli),
      debt: hm(n.need_from_sleep_debt_milli),
      strain: hm(n.need_from_recent_strain_milli),
      nap: hm(n.need_from_recent_nap_milli),
    },
    sleep_cycles: st.sleep_cycle_count,
    disturbances: st.disturbance_count,
  };
}

export function formatCycle(r: any) {
  const base = {
    date: cycleDate(r.start),
    start: localDateTime(r.start),
    end: r.end ? localDateTime(r.end) : "in progress",
  };
  const u = unscored(r);
  if (u) return { ...base, ...u };
  const s = r.score;
  return {
    ...base,
    score_state: "SCORED",
    strain: round(s.strain, 1),
    kcal: kjToKcal(s.kilojoule),
    avg_hr: s.average_heart_rate,
    max_hr: s.max_heart_rate,
    ...(r.step_count != null ? { steps: r.step_count } : {}),
  };
}

export function formatWorkout(r: any) {
  const base = {
    date: localDate(r.start),
    start: localDateTime(r.start),
    sport: r.sport_name,
    duration: hm(new Date(r.end).getTime() - new Date(r.start).getTime()),
  };
  const u = unscored(r);
  if (u) return { ...base, ...u };
  const s = r.score;
  const z = s.zone_durations ?? {};
  return {
    ...base,
    score_state: "SCORED",
    strain: round(s.strain, 1),
    kcal: kjToKcal(s.kilojoule),
    avg_hr: s.average_heart_rate,
    max_hr: s.max_heart_rate,
    ...(s.distance_meter != null
      ? { distance_km: round(s.distance_meter / 1000, 2), distance_mi: round(s.distance_meter / 1609.344, 2) }
      : {}),
    ...(s.altitude_gain_meter != null ? { elevation_gain_m: round(s.altitude_gain_meter, 0) } : {}),
    hr_zone_minutes: {
      z0: minutes(z.zone_zero_milli),
      z1: minutes(z.zone_one_milli),
      z2: minutes(z.zone_two_milli),
      z3: minutes(z.zone_three_milli),
      z4: minutes(z.zone_four_milli),
      z5: minutes(z.zone_five_milli),
    },
    percent_recorded: round(s.percent_recorded, 0),
  };
}
