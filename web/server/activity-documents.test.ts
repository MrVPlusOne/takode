import { describe, expect, it, vi } from "vitest";
import { backfillActivityRecords } from "./activity-documents.js";
import { buildSessionActivityRecord, type SessionActivityRecord } from "./activity-stream.js";
import type { RouteContext } from "./routes/context.js";
import type { BrowserIncomingMessage } from "./session-types.js";

vi.mock("./session-names.js", () => ({ getName: vi.fn() }));

const history = [{ type: "user_message", id: "m1", content: "Hello", timestamp: 1 }] as BrowserIncomingMessage[];

/** Live session "live" and archived sessions whose histories are only on disk; "done" already has a record. */
function fakeContext(records: Map<string, SessionActivityRecord>) {
  const ids = ["live", "done", "a", "b"];
  const load = vi.fn(async (_sessionId: string) => ({ messageHistory: history }));
  const ctx = {
    launcher: { listSessions: () => ids.map((sessionId) => ({ sessionId, archived: sessionId !== "live" })) },
    wsBridge: { getSession: (sessionId: string) => ({ searchDataOnly: sessionId !== "live", state: {} }) },
    sessionStore: {
      load,
      loadActivityRecord: vi.fn(async (sessionId: string) => records.get(sessionId) ?? null),
      saveActivityRecord: vi.fn(async (sessionId: string, record: SessionActivityRecord) => {
        records.set(sessionId, record);
      }),
    },
  } as unknown as RouteContext;
  return { ctx, load };
}

describe("backfillActivityRecords", () => {
  it("builds the missing records of archived sessions only, reading each history once", async () => {
    const records = new Map([["done", buildSessionActivityRecord([], false)]]);
    const { ctx, load } = fakeContext(records);
    expect(await backfillActivityRecords(ctx, { pauseMs: 0, shouldStop: () => false })).toBe(2);
    expect(load.mock.calls.map(([sessionId]) => sessionId)).toEqual(["a", "b"]);
    expect(records.get("a")).toEqual(buildSessionActivityRecord(history, false));
    // A second run finds nothing left to do.
    expect(await backfillActivityRecords(ctx, { pauseMs: 0, shouldStop: () => false })).toBe(0);
  });

  it("stops when asked, such as when the server shuts down", async () => {
    const { ctx, load } = fakeContext(new Map());
    let checks = 0;
    const result = await backfillActivityRecords(ctx, { pauseMs: 0, shouldStop: () => checks++ >= 2 });
    expect(result).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
