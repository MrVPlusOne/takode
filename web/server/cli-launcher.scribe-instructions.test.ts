import { describe, expect, it } from "vitest";
import { CliLauncher } from "./cli-launcher.js";
import { SCRIBE_BRIEF } from "./scribe-brief.js";

/**
 * A Scribe gets its brief as injected instructions on every launch and relaunch, naming its leader,
 * so the brief holds across compaction and a changed brief reaches existing Scribes on relaunch.
 * Called on the prototype with a small stand-in, avoiding process and filesystem fixtures.
 */
describe("Scribe instructions", () => {
  const launcher = {
    sessions: new Map([["leader", { sessionNum: 2957, name: "fallback", memorySessionSpaceSlug: "MSI" }]]),
    scribeLeaderName: () => "Daily Leader",
    getMemorySessionSpaceSlug: () => "Default",
    getOrchestratorGuardrails: () => "leader prompt",
    getScribeInstructions: CliLauncher.prototype.getScribeInstructions,
  };

  it("names the leader and carries the brief, on launch and on relaunch", () => {
    const instructions = CliLauncher.prototype.getScribeInstructions.call(launcher as never, "leader");
    expect(instructions).toContain('leader #2957 "Daily Leader"');
    expect(instructions).toContain("MSI session space");
    expect(instructions).toContain(SCRIBE_BRIEF);
    const relaunch = (
      CliLauncher.prototype as unknown as {
        relaunchExtraInstructions: (info: object, backend: string) => string | undefined;
      }
    ).relaunchExtraInstructions;
    expect(relaunch.call(launcher, { scribeFor: "leader" }, "claude-sdk")).toBe(instructions);
    expect(relaunch.call(launcher, { isOrchestrator: true }, "claude-sdk")).toBe("leader prompt");
  });
});
