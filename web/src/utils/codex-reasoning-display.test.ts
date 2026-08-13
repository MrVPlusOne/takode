import { describe, expect, it } from "vitest";
import { buildCodexReasoningAuthorityDisplay } from "./codex-reasoning-display.js";

const labelForEffort = (effort: string) => effort[0].toUpperCase() + effort.slice(1);

describe("Codex reasoning authority display", () => {
  it("shows Ultra without qualification only after the runtime reports Ultra", () => {
    // Requested settings alone cannot prove effective runtime behavior.
    expect(
      buildCodexReasoningAuthorityDisplay({
        requested: "ultra",
        effective: null,
        effectiveReported: false,
        runtimeConnected: true,
        labelForEffort,
      }).triggerSuffix,
    ).toBe("Ultra requested");
    expect(
      buildCodexReasoningAuthorityDisplay({
        requested: "ultra",
        effective: "ultra",
        effectiveReported: true,
        runtimeConnected: true,
        labelForEffort,
      }).triggerSuffix,
    ).toBe("Ultra");
  });

  it("keeps requested diagnostics when Codex reports a different or last effective value", () => {
    const different = buildCodexReasoningAuthorityDisplay({
      requested: "ultra",
      effective: "high",
      effectiveReported: true,
      runtimeConnected: true,
      labelForEffort,
    });
    expect(different.triggerSuffix).toBe("High · Ultra requested");
    expect(different.effectiveLabel).toBe("High");

    const disconnected = buildCodexReasoningAuthorityDisplay({
      requested: "ultra",
      effective: "ultra",
      effectiveReported: true,
      runtimeConnected: false,
      labelForEffort,
    });
    expect(disconnected.triggerSuffix).toBe("Ultra (last effective)");
  });
});
