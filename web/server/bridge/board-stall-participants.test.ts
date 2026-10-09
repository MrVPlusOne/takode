import { describe, expect, it } from "vitest";
import type { ResourceLeaseWait } from "../resource-lease-types.js";
import type { BackgroundTaskInfo } from "./adapter-interface.js";
import { describeSessionWaits } from "./board-stall-participants.js";

// describeSessionWaits feeds the `waitingFor` text that sidebar rows, the
// herd summary and the work board's worker column show for an idle session.
// It reads the same signals as the board stall check (background jobs, landing
// runs, lease queues), so a worker the board treats as waiting never looks idle.
function waitText(opts: { jobs?: BackgroundTaskInfo[]; landing?: boolean; waits?: Partial<ResourceLeaseWait>[] }) {
  return describeSessionWaits("worker", {
    getBackgroundTasks: () => (opts.jobs ? { tasks: opts.jobs, changedAt: 0 } : null),
    isLandingActive: () => opts.landing ?? false,
    getLeaseWaits: () =>
      (opts.waits ?? []).map((wait) => ({
        resourceKey: "port:takode:jiayi",
        holderSessionIds: ["holder"],
        position: 1,
        ...wait,
      })),
  });
}
const job = (taskId: string, description: string): BackgroundTaskInfo => ({ taskId, description, startedAt: 0 });

describe("describeSessionWaits", () => {
  it("returns null for a session waiting on nothing, so it keeps the plain idle dot", () => {
    expect(waitText({})).toBeNull();
    expect(waitText({ jobs: [] })).toBeNull();
  });

  it("names background jobs by their descriptions", () => {
    expect(waitText({ jobs: [job("gate", "Run full gate")] })).toBe('background job "Run full gate"');
    expect(waitText({ jobs: [job("gate", "Run full gate"), job("dev", " Dev server ")] })).toBe(
      '2 background jobs: "Run full gate", "Dev server"',
    );
    // Claude can report a task without a description.
    expect(waitText({ jobs: [job("anon", "")] })).toBe("background job");
  });

  it("shows the session's place in each lease queue", () => {
    expect(
      waitText({
        waits: [{ resourceKey: "full-suite:takode@devbox", position: 2 }, { resourceKey: "agent-browser" }],
      }),
    ).toBe("full-suite:takode@devbox (#2 in line); agent-browser (#1 in line)");
  });

  it("names an active landing run of the session's change next to its lease queues", () => {
    // Submitting no longer queues the session for the port lease (the queue holds it
    // itself), so a session waits on its landing run only while its change is in one.
    expect(waitText({ landing: true })).toBe("landing run");
    expect(waitText({ landing: true, waits: [{ resourceKey: "agent-browser" }] })).toBe(
      "landing run; agent-browser (#1 in line)",
    );
  });

  it("lists background jobs first when a session waits on several things", () => {
    expect(waitText({ jobs: [job("gate", "Run full gate")], waits: [{ resourceKey: "agent-browser" }] })).toBe(
      'background job "Run full gate"; agent-browser (#1 in line)',
    );
  });
});
