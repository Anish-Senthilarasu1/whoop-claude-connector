import { describe, expect, it } from "vitest";
import { addDays, chicagoMidnight, cycleDate, localDate, parseRange } from "../src/dates";

// 2026-10-08 15:30 CDT (UTC-5)
const NOW = new Date("2026-10-08T20:30:00Z");

describe("chicagoMidnight", () => {
  it("handles CDT and CST", () => {
    expect(chicagoMidnight("2026-10-08").toISOString()).toBe("2026-10-08T05:00:00.000Z");
    expect(chicagoMidnight("2026-12-01").toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });
  it("handles DST transition days", () => {
    expect(chicagoMidnight("2026-03-08").toISOString()).toBe("2026-03-08T06:00:00.000Z"); // spring forward at 2am
    expect(chicagoMidnight("2026-11-01").toISOString()).toBe("2026-11-01T05:00:00.000Z"); // fall back at 2am
    expect(chicagoMidnight("2026-11-02").toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
});

describe("localDate", () => {
  it("uses Chicago, not UTC", () => {
    expect(localDate("2026-10-09T03:00:00Z")).toBe("2026-10-08"); // 10pm CDT
  });
  it("addDays crosses months", () => expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
});

describe("parseRange", () => {
  it("defaults to the last 7 days through now", () => {
    const r = parseRange(undefined, undefined, NOW);
    expect(r.startDate).toBe("2026-10-02");
    expect(r.endDate).toBe("2026-10-08");
    expect(r.end).toEqual(NOW);
  });
  it("today", () => {
    const r = parseRange("today", undefined, NOW);
    expect(r.start.toISOString()).toBe("2026-10-08T05:00:00.000Z");
    expect(r.end).toEqual(NOW);
  });
  it("yesterday alone is just yesterday", () => {
    const r = parseRange("yesterday", undefined, NOW);
    expect([r.startDate, r.endDate]).toEqual(["2026-10-07", "2026-10-07"]);
    expect(r.end.toISOString()).toBe("2026-10-08T05:00:00.000Z");
  });
  it("last N days and synonyms", () => {
    expect(parseRange("last 30 days", undefined, NOW).startDate).toBe("2026-09-09");
    expect(parseRange("Past 1 day", undefined, NOW).startDate).toBe("2026-10-08");
    expect(parseRange("last week", undefined, NOW).startDate).toBe("2026-10-02");
    expect(parseRange("3 days ago", undefined, NOW).endDate).toBe("2026-10-05");
  });
  it("bare dates: end is inclusive of that day", () => {
    const r = parseRange("2026-09-01", "2026-09-03", NOW);
    expect(r.start.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-04T05:00:00.000Z");
    expect([r.startDate, r.endDate]).toEqual(["2026-09-01", "2026-09-03"]);
  });
  it("bare start date runs until now", () => {
    expect(parseRange("2026-10-01", undefined, NOW).end).toEqual(NOW);
  });
  it("end only gives the 7 days ending then", () => {
    const r = parseRange(undefined, "2026-09-10", NOW);
    expect([r.startDate, r.endDate]).toEqual(["2026-09-04", "2026-09-10"]);
  });
  it("ISO timestamps pass through", () => {
    const r = parseRange("2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z", NOW);
    expect(r.start.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });
  it("clamps end to now and rejects nonsense", () => {
    expect(parseRange("2026-10-01", "2026-12-31", NOW).end).toEqual(NOW);
    expect(() => parseRange("next tuesday", undefined, NOW)).toThrow(/Unrecognized/);
    expect(() => parseRange("2026-10-05", "2026-10-01", NOW)).toThrow(/before/);
    expect(() => parseRange("2026-11-01", undefined, NOW)).toThrow(/before/);
  });
});

describe("cycleDate", () => {
  it("assigns evening-start cycles to the next (wake) day", () => {
    expect(cycleDate("2026-10-08T04:00:00Z")).toBe("2026-10-08"); // 11pm Oct 7 CDT
    expect(cycleDate("2026-10-08T06:00:00Z")).toBe("2026-10-08"); // 1am Oct 8 CDT
  });
});
