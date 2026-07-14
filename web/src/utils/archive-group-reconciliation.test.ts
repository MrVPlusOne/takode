import { describe, expect, it } from "vitest";
import { archiveGroupRequestIds, archiveGroupSuccessfulIds } from "./archive-group-reconciliation.js";

describe("archive group reconciliation", () => {
  const workers = [{ sessionId: "worker-1" }, { sessionId: "worker-2" }];

  it("builds the full requested leader plus herd id set", () => {
    expect(archiveGroupRequestIds("leader-1", workers)).toEqual(["leader-1", "worker-1", "worker-2"]);
  });

  it("uses server-reported successes for local archived reconciliation", () => {
    // Partial failures should not mark failed members archived locally; this is
    // the missed-broadcast fallback used by the initiating archive browser.
    const archivedIds = archiveGroupSuccessfulIds("leader-1", workers, {
      ok: false,
      archived: 2,
      failed: 1,
      results: [
        { sessionId: "worker-1", ok: false, error: "kill failed" },
        { sessionId: "worker-2", ok: true },
        { sessionId: "leader-1", ok: true },
      ],
    });

    expect([...archivedIds].sort()).toEqual(["leader-1", "worker-2"]);
  });

  it("falls back to the requested group when older responses omit per-session results", () => {
    const archivedIds = archiveGroupSuccessfulIds("leader-1", workers, { ok: true, archived: 3, failed: 0 });

    expect([...archivedIds].sort()).toEqual(["leader-1", "worker-1", "worker-2"]);
  });
});
