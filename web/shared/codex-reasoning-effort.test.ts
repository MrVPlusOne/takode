import { describe, expect, it } from "vitest";
import {
  codexEffectiveReasoningEffortPatch,
  findCodexReasoningEffortSupportIssue,
  formatCodexReasoningEffortSupportIssue,
  readCodexReasoningEffortReport,
} from "./codex-reasoning-effort.js";

describe("Codex reasoning effort authority", () => {
  it("distinguishes an absent runtime report from an explicit runtime default", () => {
    // Missing fields mean Takode has no effective runtime evidence; a present null
    // is Codex explicitly reporting its default rather than a named effort.
    expect(readCodexReasoningEffortReport({})).toEqual({ reported: false, value: null });
    expect(readCodexReasoningEffortReport({ reasoningEffort: null })).toEqual({ reported: true, value: null });
    expect(readCodexReasoningEffortReport({ reasoningEffort: " Ultra " })).toEqual({
      reported: true,
      value: "ultra",
    });
    expect(codexEffectiveReasoningEffortPatch({ reported: false, value: null })).toEqual({
      codex_effective_reasoning_effort: null,
      codex_effective_reasoning_effort_reported: false,
    });
  });

  it("rejects only combinations a known model catalog explicitly marks unsupported", () => {
    // Unknown/custom models and catalogs without a level list stay backend-compatible;
    // an authoritative known list can fail closed before launch.
    const models = [
      { value: "gpt-a", supportedReasoningLevels: [{ effort: "low" }, { effort: "high" }] },
      { value: "custom-no-list" },
    ];
    const issue = findCodexReasoningEffortSupportIssue(models, "gpt-a", "ultra");
    expect(issue).toEqual({ model: "gpt-a", effort: "ultra", supported: ["low", "high"] });
    expect(formatCodexReasoningEffortSupportIssue(issue!)).toContain('"ultra" is not supported by model "gpt-a"');
    expect(findCodexReasoningEffortSupportIssue(models, "gpt-a", "high")).toBeNull();
    expect(findCodexReasoningEffortSupportIssue(models, "custom-no-list", "ultra")).toBeNull();
    expect(findCodexReasoningEffortSupportIssue(models, "unknown", "ultra")).toBeNull();
  });
});
