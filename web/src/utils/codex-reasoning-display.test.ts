import { describe, expect, it } from "vitest";
import { buildCodexReasoningAuthorityDisplay } from "./codex-reasoning-display.js";

const labelForEffort = (effort: string) => effort[0].toUpperCase() + effort.slice(1);

describe("Codex reasoning authority display", () => {
  it("keeps the selected effort as the ordinary label when runtime evidence is missing", () => {
    // The normal selector describes the user's setting; absence of runtime proof
    // remains available in diagnostics without changing that selector language.
    const display = buildCodexReasoningAuthorityDisplay({
      requested: "ultra",
      effective: null,
      effectiveReported: false,
      runtimeConnected: true,
      labelForEffort,
    });

    expect(display.triggerSuffix).toBe("Ultra");
    expect(display.selectedLabel).toBe("Ultra");
    expect(display.runtimeStatus).toBe("unreported");
    expect(display.warningLabel).toBeNull();
    expect(display.title).toBe("Selected: Ultra; runtime effort: not reported");
  });

  it("turns a reported mismatch into a compact warning without replacing the selected effort", () => {
    // Codex-reported effort is still authoritative for mismatch detection, but
    // the ordinary selector remains the single editable selected value.
    const connected = buildCodexReasoningAuthorityDisplay({
      requested: "ultra",
      effective: "high",
      effectiveReported: true,
      runtimeConnected: true,
      labelForEffort,
    });
    expect(connected.triggerSuffix).toBe("Ultra");
    expect(connected.runtimeStatus).toBe("mismatch");
    expect(connected.effectiveLabel).toBe("High");
    expect(connected.warningLabel).toBe("Runtime is using High instead of Ultra.");
    expect(connected.title).toBe("Selected: Ultra; runtime: High");

    const disconnected = buildCodexReasoningAuthorityDisplay({
      requested: "ultra",
      effective: "high",
      effectiveReported: true,
      runtimeConnected: false,
      labelForEffort,
    });
    expect(disconnected.triggerSuffix).toBe("Ultra");
    expect(disconnected.effectiveLabel).toBe("High (last reported)");
    expect(disconnected.warningLabel).toBe("Last runtime used High instead of Ultra.");
  });

  it("uses the model default when comparing an implicit selected effort", () => {
    // Empty requested effort means the model default, so matching runtime proof
    // must not produce a false downgrade warning.
    const display = buildCodexReasoningAuthorityDisplay({
      requested: "",
      effective: "medium",
      effectiveReported: true,
      runtimeConnected: true,
      defaultRequested: "medium",
      defaultRequestedLabel: "Medium",
      labelForEffort,
    });

    expect(display.selectedLabel).toBe("Medium (default)");
    expect(display.triggerSuffix).toBe("Medium");
    expect(display.runtimeStatus).toBe("reported");
    expect(display.warningLabel).toBeNull();
  });
});
