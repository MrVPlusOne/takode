import { describe, expect, it } from "vitest";
import type { SdkSessionInfo } from "./types.js";
import { sdkSessionListEqual } from "./store-equality.js";

function session(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    ...overrides,
  };
}

describe("sdkSessionListEqual", () => {
  it("detects launch configuration changes used by Configure Session", () => {
    expect(sdkSessionListEqual([session({ codexMaxContextLength: 600_000 })], [session()])).toBe(false);
    expect(sdkSessionListEqual([session({ claudeMaxContextLength: 1_000_000 })], [session()])).toBe(false);
    expect(
      sdkSessionListEqual([session({ codexInternetAccess: true })], [session({ codexInternetAccess: false })]),
    ).toBe(false);
    expect(sdkSessionListEqual([session({ claudeReasoningEffort: "max" })], [session()])).toBe(false);
    expect(sdkSessionListEqual([session({ codexEffectiveReasoningEffort: "ultra" })], [session()])).toBe(false);
    expect(sdkSessionListEqual([session({ codexEffectiveReasoningEffortReported: true })], [session()])).toBe(false);
  });

  it("detects a server-authored model provenance migration warning", () => {
    const migration = {
      eventId: "model-provenance-migration:test",
      code: "model_provenance_unavailable" as const,
      source: "legacy_relaunch" as const,
      selectedModel: "gpt-5.6-sol",
      authority: {
        model: "gpt-5.6-sol",
        source: "managed_fallback" as const,
        policyVersion: "test",
        overrideTrace: [
          {
            model: "gpt-5.6-sol",
            source: "managed_fallback" as const,
            precedence: 100,
            status: "selected" as const,
          },
        ],
      },
      migratedAt: 123,
      warning: "Original provenance unavailable",
    };
    expect(sdkSessionListEqual([session({ modelProvenanceMigration: migration })], [session()])).toBe(false);
    expect(
      sdkSessionListEqual(
        [session({ modelProvenanceMigration: { ...migration, acknowledgedAt: 456 } })],
        [session({ modelProvenanceMigration: migration })],
      ),
    ).toBe(false);
  });

  it("detects Codex context accounting and compaction provenance changes", () => {
    const tokenDetails = {
      contextTokensUsed: 423_969,
      displayContextTokensUsed: 424_464,
      providerReportedTotalTokens: 424_464,
      inputTokens: 423_969,
      outputTokens: 495,
      cachedInputTokens: 423_424,
      reasoningOutputTokens: 167,
      modelContextWindow: 770_000,
    };
    const diagnostics = {
      role: "leader" as const,
      leaderMode: "compact" as const,
      capacitySource: "configured_usable_capacity" as const,
      configuredUsableContextWindow: 770_000,
      providerRawContextWindow: 810_527,
      providerEffectiveContextWindow: 770_000,
      autoCompactTokenLimit: 693_000,
      autoCompactTokenLimitScope: "total" as const,
      autoCompactTokenLimitScopeSource: "codex_default" as const,
    };
    const lifecycleEvent = {
      type: "compaction" as const,
      id: "compact-1",
      timestamp: 1,
      backendType: "codex" as const,
      trigger: "auto" as const,
      cause: "unknown" as const,
      contextWindowDiagnostics: diagnostics,
      before: {
        contextTokensUsed: 424_464,
        providerReportedInputTokens: 423_969,
        providerReportedTotalTokens: 424_464,
        contextUsedPercent: 55,
        modelContextWindow: 770_000,
        autoCompactTokenLimit: 693_000,
        autoCompactTokenLimitScope: "total" as const,
        source: "codex_token_details" as const,
        capturedAt: 1,
      },
    };
    const baseline = session({
      codexTokenDetails: tokenDetails,
      codexContextWindowDiagnostics: diagnostics,
      sessionLifecycleEvents: [lifecycleEvent],
    });

    expect(
      sdkSessionListEqual(
        [baseline],
        [session({ ...baseline, codexTokenDetails: { ...tokenDetails, providerReportedTotalTokens: 424_465 } })],
      ),
    ).toBe(false);
    expect(
      sdkSessionListEqual(
        [baseline],
        [
          session({
            ...baseline,
            codexContextWindowDiagnostics: { ...diagnostics, autoCompactTokenLimitScopeSource: "configured" },
          }),
        ],
      ),
    ).toBe(false);
    expect(
      sdkSessionListEqual(
        [baseline],
        [
          session({
            ...baseline,
            sessionLifecycleEvents: [{ ...lifecycleEvent, cause: "context_pressure", causeSource: "producer" }],
          }),
        ],
      ),
    ).toBe(false);
    expect(
      sdkSessionListEqual(
        [baseline],
        [
          session({
            ...baseline,
            sessionLifecycleEvents: [
              {
                ...lifecycleEvent,
                before: { ...lifecycleEvent.before, providerReportedTotalTokens: 424_465 },
              },
            ],
          }),
        ],
      ),
    ).toBe(false);
  });
});
