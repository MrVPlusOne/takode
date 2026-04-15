import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDuration, parseWallClock, resolveTimerSchedule } from "./timer-parse.js";

// ─── parseDuration ───────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1s")).toBe(1_000);
    expect(parseDuration("90s")).toBe(90_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1m")).toBe(60_000);
    expect(parseDuration("30m")).toBe(1_800_000);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("parses compound durations", () => {
    expect(parseDuration("2h30m")).toBe(9_000_000);
    expect(parseDuration("1h15m30s")).toBe(4_530_000);
    expect(parseDuration("0h5m")).toBe(300_000);
  });

  it("handles fractional simple durations", () => {
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("0.5m")).toBe(30_000);
  });

  it("trims whitespace", () => {
    expect(parseDuration("  5m  ")).toBe(300_000);
  });

  it("is case insensitive", () => {
    expect(parseDuration("5M")).toBe(300_000);
    expect(parseDuration("2H")).toBe(7_200_000);
  });

  it("rejects empty string", () => {
    expect(() => parseDuration("")).toThrow("cannot be empty");
  });

  it("rejects invalid formats", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration");
    expect(() => parseDuration("5")).toThrow("Invalid duration");
    expect(() => parseDuration("5x")).toThrow("Invalid duration");
    expect(() => parseDuration("-5m")).toThrow("Invalid duration");
  });

  it("rejects zero duration", () => {
    expect(() => parseDuration("0m")).toThrow("must be positive");
    expect(() => parseDuration("0s")).toThrow("must be positive");
  });
});

// ─── parseWallClock ──────────────────────────────────────────────────────────

describe("parseWallClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses 12-hour time with pm", () => {
    // Fix time to 10am so 3pm is in the future
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("3pm");
    const date = new Date(result);
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(0);
  });

  it("parses 12-hour time with am", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T06:00:00") });

    const result = parseWallClock("9am");
    const date = new Date(result);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  it("parses 12-hour time with minutes", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("3:30pm");
    const date = new Date(result);
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(30);
  });

  it("parses 24-hour time", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("15:00");
    const date = new Date(result);
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(0);
  });

  it("handles midnight (12am)", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("12am");
    const date = new Date(result);
    // 12am (midnight) is hour 0, which is in the past if current time is 10am,
    // so it should schedule for tomorrow
    expect(date.getHours()).toBe(0);
    expect(date.getDate()).toBe(9); // tomorrow
  });

  it("handles noon (12pm)", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("12pm");
    const date = new Date(result);
    expect(date.getHours()).toBe(12);
    expect(date.getMinutes()).toBe(0);
    expect(date.getDate()).toBe(8); // today (still in future)
  });

  it("schedules for tomorrow if time has passed", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T16:00:00") });

    const result = parseWallClock("3pm");
    const date = new Date(result);
    expect(date.getHours()).toBe(15);
    expect(date.getDate()).toBe(9); // tomorrow
  });

  it("schedules for today if time is in the future", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("3pm");
    const date = new Date(result);
    expect(date.getDate()).toBe(8); // today
  });

  it("trims whitespace", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = parseWallClock("  3pm  ");
    const date = new Date(result);
    expect(date.getHours()).toBe(15);
  });

  it("rejects empty string", () => {
    expect(() => parseWallClock("")).toThrow("cannot be empty");
  });

  it("rejects invalid formats", () => {
    expect(() => parseWallClock("abc")).toThrow("Invalid time");
    expect(() => parseWallClock("25:00")).toThrow("Invalid hour");
    expect(() => parseWallClock("13pm")).toThrow("Invalid hour");
    expect(() => parseWallClock("3:60pm")).toThrow("Invalid minutes");
  });
});

// ─── resolveTimerSchedule ────────────────────────────────────────────────────

describe("resolveTimerSchedule", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves delay (--in)", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = resolveTimerSchedule({ title: "test", in: "30m" });
    expect(result.type).toBe("delay");
    expect(result.nextFireAt).toBe(Date.now() + 1_800_000);
    expect(result.intervalMs).toBeUndefined();
    expect(result.originalSpec).toBe("30m");
  });

  it("resolves wall-clock (--at)", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = resolveTimerSchedule({ title: "test", at: "3pm" });
    expect(result.type).toBe("at");
    expect(result.originalSpec).toBe("3pm");
    const date = new Date(result.nextFireAt);
    expect(date.getHours()).toBe(15);
  });

  it("resolves recurring (--every)", () => {
    vi.useFakeTimers({ now: new Date("2026-04-08T10:00:00") });

    const result = resolveTimerSchedule({ title: "test", every: "10m" });
    expect(result.type).toBe("recurring");
    expect(result.nextFireAt).toBe(Date.now() + 600_000);
    expect(result.intervalMs).toBe(600_000);
    expect(result.originalSpec).toBe("10m");
  });

  it("rejects no schedule spec", () => {
    expect(() => resolveTimerSchedule({ title: "test" })).toThrow("One of");
  });

  it("rejects multiple schedule specs", () => {
    expect(() => resolveTimerSchedule({ title: "test", in: "5m", every: "10m" })).toThrow("Only one");
  });
});
