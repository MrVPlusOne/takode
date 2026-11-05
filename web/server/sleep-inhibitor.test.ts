import { describe, it, expect, vi } from "vitest";
import { SleepInhibitor } from "./sleep-inhibitor.js";
import type { Caffeinate } from "./caffeinate.js";

function fakeCaffeinate() {
  return { keepAwakeFor: vi.fn(), stop: vi.fn() };
}

/** Sessions by id: the machine they run on (`hostId`, none for this one) and whether they are mid-turn. */
function inhibitorFor(
  sessions: Record<string, { hostId?: string; generating: boolean; state?: string }>,
  keepAwake: Record<string, boolean> = {},
) {
  const caffeinate = fakeCaffeinate();
  const keepHostAwake = vi.fn();
  const inhibitor = new SleepInhibitor({
    wsBridge: { getSession: (id: string) => ({ isGenerating: sessions[id]?.generating }) } as never,
    launcher: {
      listSessions: () =>
        Object.entries(sessions).map(([sessionId, s]) => ({
          sessionId,
          hostId: s.hostId,
          state: s.state ?? "connected",
        })),
    } as never,
    getSettings: () => ({ sleepInhibitorDurationMinutes: 10 }),
    keepAwakeOn: (machineId) => keepAwake[machineId] !== false,
    keepHostAwake,
    caffeinate: caffeinate as unknown as Caffeinate,
  });
  return { inhibitor, caffeinate, keepHostAwake };
}

// Each machine is kept awake while one of its own sessions is mid-turn: this machine with
// caffeinate here, a remote host by asking its node, which does it on macOS.
describe("SleepInhibitor", () => {
  it("keeps only the machines with a session mid-turn awake, each its own way", () => {
    const { inhibitor, caffeinate, keepHostAwake } = inhibitorFor({
      here: { generating: true },
      "laptop-busy": { hostId: "laptop", generating: true },
      "laptop-idle": { hostId: "laptop", generating: false },
      "condor-idle": { hostId: "condor", generating: false },
    });
    inhibitor.sweep();
    expect(caffeinate.keepAwakeFor).toHaveBeenCalledWith(600);
    expect(keepHostAwake).toHaveBeenCalledTimes(1);
    expect(keepHostAwake).toHaveBeenCalledWith("laptop", 600);
  });

  it("leaves this machine alone when only another machine's session is mid-turn", () => {
    const { inhibitor, caffeinate, keepHostAwake } = inhibitorFor({
      "laptop-busy": { hostId: "laptop", generating: true },
    });
    inhibitor.sweep();
    expect(caffeinate.keepAwakeFor).not.toHaveBeenCalled();
    expect(keepHostAwake).toHaveBeenCalledWith("laptop", 600);
  });

  it("skips machines whose keep-awake setting is off, and lets this machine sleep at once", () => {
    const { inhibitor, caffeinate, keepHostAwake } = inhibitorFor(
      { here: { generating: true }, laptop: { hostId: "laptop", generating: true } },
      { local: false, laptop: false },
    );
    inhibitor.sweep();
    expect(caffeinate.keepAwakeFor).not.toHaveBeenCalled();
    expect(caffeinate.stop).toHaveBeenCalled();
    expect(keepHostAwake).not.toHaveBeenCalled();
  });

  it("ignores exited sessions and machines with no turn under way", () => {
    const { inhibitor, caffeinate, keepHostAwake } = inhibitorFor({
      gone: { hostId: "laptop", generating: true, state: "exited" },
      idle: { generating: false },
    });
    inhibitor.sweep();
    expect(caffeinate.keepAwakeFor).not.toHaveBeenCalled();
    expect(keepHostAwake).not.toHaveBeenCalled();
  });

  it("stops keeping this machine awake when it stops", () => {
    const { inhibitor, caffeinate } = inhibitorFor({});
    inhibitor.start(60_000);
    inhibitor.stop();
    expect(caffeinate.stop).toHaveBeenCalled();
  });
});
