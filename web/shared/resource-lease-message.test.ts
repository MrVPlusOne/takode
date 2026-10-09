import { describe, expect, it } from "vitest";
import {
  formatLeaseWaitDuration,
  formatResourceLeaseMessageLine,
  parseResourceLeaseMessageFields,
  stripResourceLeaseMessageFields,
} from "./resource-lease-message.js";

describe("resource lease message contract", () => {
  it("formats wait durations at a readable precision", () => {
    expect(formatLeaseWaitDuration(0)).toBe("<1s");
    expect(formatLeaseWaitDuration(999)).toBe("<1s");
    expect(formatLeaseWaitDuration(45_400)).toBe("45s");
    expect(formatLeaseWaitDuration(3 * 60_000 + 12_000)).toBe("3m 12s");
    expect(formatLeaseWaitDuration(2 * 3_600_000 + 5 * 60_000 + 30_000)).toBe("2h 5m");
    // A clock that moved backwards must not produce a negative wait.
    expect(formatLeaseWaitDuration(-5_000)).toBe("<1s");
  });

  it("parses the lines the server writes and strips them from the remaining text", () => {
    const content = [
      "[Resource lease acquired] You now hold `port:takode:jiayi`.",
      "",
      formatResourceLeaseMessageLine("slot", "1 of 1"),
      formatResourceLeaseMessageLine("purpose", "Port fixes: retry later"),
      formatResourceLeaseMessageLine("acquired", "2026-10-08T20:46:00.000Z"),
      formatResourceLeaseMessageLine("waited", "3m 12s"),
      formatResourceLeaseMessageLine("expires", "2026-10-08T21:16:00.000Z"),
      "",
      "Heartbeat with `takode lease renew port:takode:jiayi`.",
    ].join("\n");

    expect(parseResourceLeaseMessageFields(content)).toEqual({
      slot: "1 of 1",
      purpose: "Port fixes: retry later",
      acquired: "2026-10-08T20:46:00.000Z",
      waited: "3m 12s",
      expires: "2026-10-08T21:16:00.000Z",
    });
    expect(stripResourceLeaseMessageFields(content)).toBe(
      [
        "[Resource lease acquired] You now hold `port:takode:jiayi`.",
        "",
        "Heartbeat with `takode lease renew port:takode:jiayi`.",
      ].join("\n"),
    );
  });

  it("leaves fields missing from older messages unset", () => {
    expect(parseResourceLeaseMessageFields("Purpose: Inspect UI\nExpires: 2026-05-10T04:00:00.000Z")).toEqual({
      purpose: "Inspect UI",
      expires: "2026-05-10T04:00:00.000Z",
    });
  });
});
