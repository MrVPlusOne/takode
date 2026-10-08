import {
  configureMachines,
  describeMachine,
  machineContextForHost,
  machineContextForSession,
  sessionMachineName,
} from "./machines.js";

// Sessions and quest notes name machines through one directory: the
// coordinator's own machine, registered hosts and each session's host.
describe("machines", () => {
  beforeEach(() => {
    configureMachines({
      local: () => ({ name: "laptop", platform: "darwin", user: "ana", home: "/Users/ana" }),
      hostName: (hostId) => (hostId === "h1" ? "devbox" : null),
      hostDetails: (hostId) => (hostId === "h1" ? { platform: "linux", user: "ana", home: "/home/ana" } : null),
      sessionHostId: (sessionId) => ({ local: null, remote: "h1", gone: "h2" })[sessionId],
    });
  });

  afterEach(() => configureMachines(null));

  it("names the machine each session runs on", () => {
    expect(sessionMachineName("local")).toBe("laptop");
    expect(sessionMachineName("remote")).toBe("devbox");
    // Unknown sessions and hosts that are no longer registered get no stamp.
    expect(sessionMachineName("unknown")).toBeUndefined();
    expect(sessionMachineName("gone")).toBeUndefined();
    expect(sessionMachineName(undefined)).toBeUndefined();
    expect(describeMachine("h1")).toEqual({ name: "devbox", platform: "linux", user: "ana", home: "/home/ana" });
  });

  // A remote session learns both machines; a local one learns that it shares
  // the coordinator's machine. Both learn what a stamp on a note means.
  it("describes where a session runs and where the coordinator runs", () => {
    expect(machineContextForSession("remote")).toBe(
      "This session runs on machine `devbox` (Linux, user `ana`, home `/home/ana`). " +
        "The Takode coordinator, which holds quests and memory, runs on machine `laptop` (macOS). " +
        "Quest notes, debriefs and memory notes are stamped with the machine they were written on: paths, commands and environment details in notes from another machine describe that machine, not this one.",
    );
    expect(machineContextForHost(null)).toContain(
      "This session runs on machine `laptop` (macOS, user `ana`, home `/Users/ana`), which also runs the Takode coordinator",
    );
    expect(machineContextForSession("unknown")).toBeNull();
  });

  it("says nothing when no directory is configured", () => {
    configureMachines(null);
    expect(machineContextForHost(null)).toBeNull();
    expect(sessionMachineName("local")).toBeUndefined();
  });
});
