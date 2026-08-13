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
});
