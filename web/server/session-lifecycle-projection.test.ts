import { describe, expect, it } from "vitest";
import { projectSessionLifecycleEvents } from "./session-lifecycle-projection.js";

const diagnostics = {
  role: "non_leader" as const,
  capacitySource: "configured_usable_capacity" as const,
  autoCompactTokenLimit: 684_000,
  autoCompactTokenLimitScope: "total" as const,
};

describe("projectSessionLifecycleEvents", () => {
  it("normalizes legacy inferred pressure and configured-limit snapshots", () => {
    const [event] = projectSessionLifecycleEvents(
      [
        {
          type: "compaction",
          id: "compact-legacy",
          timestamp: 1,
          backendType: "codex",
          cause: "context_pressure",
          contextWindowDiagnostics: diagnostics,
          before: {
            contextTokensUsed: 684_000,
            providerReportedInputTokens: 453_024,
            providerReportedTotalTokens: 453_737,
            contextUsedPercent: 90,
            modelContextWindow: 760_000,
            autoCompactTokenLimit: 684_000,
            source: "codex_auto_compact_limit",
            capturedAt: 1,
          },
        },
      ],
      { includeContextWindowDiagnostics: true },
    );

    expect(event).toMatchObject({
      cause: "unknown",
      contextWindowDiagnostics: diagnostics,
      before: {
        contextTokensUsed: 453_737,
        providerReportedInputTokens: 453_024,
        providerReportedTotalTokens: 453_737,
        contextUsedPercent: 60,
        source: "codex_token_details",
      },
    });
    expect(event).not.toHaveProperty("causeSource");
  });

  it("drops a legacy synthetic snapshot when no provider observation survives", () => {
    const [event] = projectSessionLifecycleEvents([
      {
        type: "compaction",
        id: "compact-no-observation",
        timestamp: 1,
        backendType: "codex",
        cause: "context_pressure",
        before: {
          contextTokensUsed: 684_000,
          contextUsedPercent: 90,
          source: "codex_auto_compact_limit",
          capturedAt: 1,
        },
      },
    ]);

    expect(event).toMatchObject({ cause: "unknown" });
    expect(event).not.toHaveProperty("before");
  });

  it("preserves producer-sourced pressure and observed provider snapshots", () => {
    const original = {
      type: "compaction" as const,
      id: "compact-producer",
      timestamp: 1,
      backendType: "codex" as const,
      cause: "context_pressure" as const,
      causeSource: "producer" as const,
      before: {
        contextTokensUsed: 453_737,
        providerReportedInputTokens: 453_024,
        providerReportedTotalTokens: 453_737,
        contextUsedPercent: 60,
        source: "codex_token_details" as const,
        capturedAt: 1,
      },
    };

    expect(projectSessionLifecycleEvents([original])).toEqual([original]);
  });
});
