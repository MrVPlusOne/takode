import { nestedPoolWarning, stillWaitingLine } from "./pool-wait-notes.js";

/**
 * The notes `takode lease run` and `takode exec --pool` print about slot
 * waits. A command started inside a held slot carries TAKODE_LEASE_RESOURCE
 * and TAKODE_LEASE_SLOT; that is how a nested pool request is recognized.
 */
describe("pool wait notes", () => {
  const inside = { TAKODE_LEASE_RESOURCE: "lean@condor", TAKODE_LEASE_SLOT: "2" };

  it("warns only from inside a held slot, naming both pools and the risk", () => {
    expect(nestedPoolWarning("lean", {})).toBeNull();
    // The same pool with or without its machine is the dangerous case.
    const same = nestedPoolWarning("lean", inside);
    expect(same).toContain("already runs inside slot 2 of lean@condor and now waits for a slot of lean");
    expect(same).toContain("once outer commands hold every slot");
    // Another pool deadlocks only with opposite ordering elsewhere.
    expect(nestedPoolWarning("rocq@condor", inside)).toContain(
      "if other commands hold rocq@condor while they wait for lean@condor",
    );
  });

  it("says how long a wait has gone on, where it stands and, inside a slot, that it may wait on itself", () => {
    const note = "lean@condor: place 1 in line, 4/4 slots held by #7 (yours) x4, none changed hands for 40m 0s";
    expect(stillWaitingLine(15 * 60_000, note, {})).toBe(`still waiting for a slot after 15m 0s: ${note}`);
    expect(stillWaitingLine(15 * 60_000, undefined, inside)).toBe(
      "still waiting for a slot after 15m 0s. It runs inside a slot of lean@condor itself, so this may be a nested-slot deadlock",
    );
  });
});
