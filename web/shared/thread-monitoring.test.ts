import { describe, expect, it } from "vitest";
import { isThreadMonitoringProjectionValue } from "./thread-monitoring.js";

describe("monitoring projection shape", () => {
  const value = {
    revision: 2,
    alertVersion: 1,
    trackedCount: 2,
    pendingCount: 1,
    threads: { "q-42": { pendingResultId: "2" } },
  };
  it("accepts bounded open-tab detail with larger global counts", () => {
    expect(isThreadMonitoringProjectionValue(value)).toBe(true);
    expect(isThreadMonitoringProjectionValue({ ...value, threads: {} })).toBe(true);
  });
  it("accepts Main only while a reminder's result waits to be acknowledged", () => {
    // A due "Remind me later" gives Main a pending result; acknowledging it removes Main again,
    // so a Main entry without a pending result never comes from the server.
    expect(isThreadMonitoringProjectionValue({ ...value, threads: { main: { pendingResultId: "2" } } })).toBe(true);
  });
  it.each([
    { threads: [] },
    { threads: { main: { pendingResultId: null } } },
    { threads: { "q-42": {} } },
    { pendingCount: 0 },
    { trackedCount: 0 },
    { revision: -1 },
    { alertVersion: "1" },
    { threads: { "q-42": { pendingResultId: "invalid" } } },
  ])("rejects malformed or inconsistent authoritative values: %o", (patch) => {
    // A partial or malformed snapshot must never manufacture monitoring state.
    expect(isThreadMonitoringProjectionValue({ ...value, ...patch })).toBe(false);
  });
});
