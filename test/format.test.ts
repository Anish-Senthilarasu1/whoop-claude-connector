import { describe, expect, it } from "vitest";
import { cToF, formatCycle, formatRecovery, formatSleep, formatWorkout, hm, kjToKcal, metersToFeetInches } from "../src/format";

const H = 3_600_000;
const M = 60_000;

describe("unit conversion", () => {
  it("hm", () => {
    expect(hm(7 * H + 5 * M)).toBe("7:05");
    expect(hm(59.6 * M)).toBe("1:00");
    expect(hm(-30 * M)).toBe("-0:30");
    expect(hm(0)).toBe("0:00");
    expect(hm(null)).toBeNull();
  });
  it("kcal / temps / height", () => {
    expect(kjToKcal(4184)).toBe(1000);
    expect(cToF(33.5)).toBe(92.3);
    expect(metersToFeetInches(1.8)).toBe(`5'11"`);
  });
});

const sleep = {
  id: "s1", cycle_id: 1, nap: false, score_state: "SCORED",
  start: "2026-10-08T04:15:00Z", end: "2026-10-08T12:00:00Z",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 7.75 * H, total_awake_time_milli: 30 * M, total_no_data_time_milli: 0,
      total_light_sleep_time_milli: 3.5 * H, total_slow_wave_sleep_time_milli: 1.5 * H, total_rem_sleep_time_milli: 2 * H - 15 * M,
      sleep_cycle_count: 5, disturbance_count: 9,
    },
    sleep_needed: { baseline_milli: 8 * H, need_from_sleep_debt_milli: 20 * M, need_from_recent_strain_milli: 10 * M, need_from_recent_nap_milli: 0 },
    respiratory_rate: 14.62, sleep_performance_percentage: 81, sleep_consistency_percentage: 70.4, sleep_efficiency_percentage: 93.6,
  },
};

describe("formatSleep", () => {
  it("summarizes stages and need vs actual", () => {
    const f = formatSleep(sleep) as any;
    expect(f.date).toBe("2026-10-08");
    expect(f.start).toBe("2026-10-07 23:15");
    expect(f.asleep).toBe("6:45");
    expect(f.sleep_need).toBe("8:30");
    expect(f.need_vs_actual).toBe("-1:45");
    expect(f.rem).toBe("1:45");
    expect(f.efficiency_pct).toBe(94);
    expect(f.respiratory_rate).toBe(14.6);
  });
  it("surfaces PENDING_SCORE / UNSCORABLE", () => {
    const p = formatSleep({ ...sleep, score_state: "PENDING_SCORE", score: undefined }) as any;
    expect(p.score_state).toBe("PENDING_SCORE");
    expect(p.note).toMatch(/PENDING_SCORE/);
    expect(p.performance_pct).toBeUndefined();
    const u = formatRecovery({ cycle_id: 1, score_state: "UNSCORABLE" }, "2026-10-08") as any;
    expect(u.note).toMatch(/UNSCORABLE/);
  });
});

describe("other formatters", () => {
  it("recovery", () => {
    const f = formatRecovery(
      { cycle_id: 1, score_state: "SCORED", score: { recovery_score: 66.4, hrv_rmssd_milli: 48.234, resting_heart_rate: 52, spo2_percentage: 96.1, skin_temp_celsius: 33.71, user_calibrating: false } },
      "2026-10-08",
    ) as any;
    expect(f).toMatchObject({ recovery_pct: 66, hrv_ms: 48.2, resting_hr: 52, skin_temp_f: 92.7 });
    expect(f.calibrating).toBeUndefined();
  });
  it("cycle in progress", () => {
    const f = formatCycle({ start: "2026-10-08T04:00:00Z", score_state: "SCORED", score: { strain: 8.456, kilojoule: 8368, average_heart_rate: 70, max_heart_rate: 150 } }) as any;
    expect(f).toMatchObject({ date: "2026-10-08", end: "in progress", strain: 8.5, kcal: 2000 });
  });
  it("workout zones and distance", () => {
    const f = formatWorkout({
      start: "2026-10-08T12:00:00Z", end: "2026-10-08T12:45:30Z", sport_name: "running", score_state: "SCORED",
      score: { strain: 12.3, kilojoule: 2092, average_heart_rate: 150, max_heart_rate: 180, percent_recorded: 100, distance_meter: 8046.72,
        zone_durations: { zone_zero_milli: 0, zone_one_milli: 5 * M, zone_two_milli: 10 * M, zone_three_milli: 20 * M, zone_four_milli: 10 * M, zone_five_milli: 30_000 } },
    }) as any;
    expect(f.duration).toBe("0:46");
    expect(f.distance_mi).toBe(5);
    expect(f.hr_zone_minutes).toEqual({ z0: 0, z1: 5, z2: 10, z3: 20, z4: 10, z5: 1 });
    expect(f.kcal).toBe(500);
  });
});
