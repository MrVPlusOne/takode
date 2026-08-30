import { describe, expect, it } from "vitest";
import {
  recordCompactionBoundary,
  recordCompactionFinished,
  recordCompactionStarted,
} from "./session-lifecycle-events.js";
import type { CodexCompactionCause, SessionState } from "../session-types.js";

function makeSession(state: Partial<SessionState> = {}) {
  return {
    backendType: "codex" as const,
    state: {
      session_id: "s1",
      context_used_percent: 0,
      ...state,
    } as SessionState,
  };
}

function configuredCodexState(overrides: Partial<NonNullable<SessionState["codex_token_details"]>> = {}) {
  return {
    context_used_percent: 61,
    codex_token_details: {
      contextTokensUsed: 464_542,
      providerReportedTotalTokens: 470_000,
      inputTokens: 1_200_000,
      outputTokens: 50_000,
      cachedInputTokens: 930_000,
      reasoningOutputTokens: 2_000,
      modelContextWindow: 760_000,
      ...overrides,
    },
    codex_context_window_diagnostics: {
      role: "non_leader" as const,
      capacitySource: "configured_usable_capacity" as const,
      configuredUsableContextWindow: 770_000,
      displayContextWindow: 770_000,
      providerRawContextWindow: 800_000,
      autoCompactTokenLimit: 684_000,
      autoCompactTokenLimitScope: "total" as const,
    },
  };
}

describe("session lifecycle compaction events", () => {
  it("records Claude compact_boundary pre_tokens as a known before context length", () => {
    // compact_boundary metadata is the reliable Claude source for pre-compaction
    // token length; the lifecycle event should preserve it for Session Info.
    const session = makeSession();

    recordCompactionBoundary(session, {
      id: "compact-boundary-1",
      timestamp: 1000,
      trigger: "auto",
      preTokens: 180_000,
    });

    expect(session.state.lifecycle_events).toEqual([
      {
        type: "compaction",
        id: "compact-boundary-1",
        timestamp: 1000,
        backendType: "codex",
        trigger: "auto",
        before: {
          contextTokensUsed: 180_000,
          source: "compact_boundary",
          capturedAt: 1000,
        },
      },
    ]);
  });

  it("keeps a producer-reported pressure cause separate from observed provider totals", () => {
    // Even when a future producer can identify context pressure, app-server
    // usage still does not expose Codex's active-context counter. Preserve the
    // observed last total and keep launch configuration as separate provenance.
    const session = makeSession(configuredCodexState());

    recordCompactionStarted(session, {
      id: "compact-pressure",
      timestamp: 1000,
      trigger: "auto",
      cause: "context_pressure",
      causeSource: "producer",
    });

    expect(session.state.lifecycle_events?.[0]).toEqual(
      expect.objectContaining({
        trigger: "auto",
        cause: "context_pressure",
        causeSource: "producer",
        contextWindowDiagnostics: expect.objectContaining({
          displayContextWindow: 770_000,
          autoCompactTokenLimit: 684_000,
          autoCompactTokenLimitScope: "total",
        }),
        before: {
          contextTokensUsed: 470_000,
          providerReportedInputTokens: 464_542,
          providerReportedTotalTokens: 470_000,
          contextUsedPercent: 62,
          modelContextWindow: 760_000,
          autoCompactTokenLimit: 684_000,
          autoCompactTokenLimitScope: "total",
          source: "codex_token_details",
          capturedAt: 1000,
        },
      }),
    );
  });

  it("does not promote a configured auto-compact setting into observed usage", () => {
    // A launch/config value is not a trigger-time active-context measurement,
    // even when it exceeds the reported runtime window.
    const state = configuredCodexState();
    state.codex_context_window_diagnostics.autoCompactTokenLimit = 900_000;
    const session = makeSession(state);

    recordCompactionStarted(session, {
      id: "compact-unclassified",
      timestamp: 1000,
      trigger: "auto",
      cause: "unknown",
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      cause: "unknown",
      before: {
        contextTokensUsed: 470_000,
        contextUsedPercent: 62,
        modelContextWindow: 760_000,
        autoCompactTokenLimit: 900_000,
        source: "codex_token_details",
      },
    });
  });

  it("uses the hidden provider-effective window without inventing recycle-mode charge", () => {
    // Recycle leaders rewrite ordinary stats to the Takode display budget. A
    // provider compaction snapshot can use the hidden provider denominator,
    // but the configured guard must not be substituted for observed usage.
    const session = makeSession({
      context_used_percent: 95,
      codex_token_details: {
        contextTokensUsed: 518_000,
        providerReportedTotalTokens: 525_000,
        inputTokens: 518_000,
        outputTokens: 7_000,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        modelContextWindow: 545_000,
      },
      codex_context_window_diagnostics: {
        role: "leader",
        leaderMode: "recycle",
        capacitySource: "leader_recycle_guard",
        displayContextWindow: 545_000,
        providerRawContextWindow: 3_027_778,
        catalogEffectiveContextWindowPercent: 95,
        providerEffectiveContextWindow: 2_876_389,
        autoCompactTokenLimit: 2_725_000,
        autoCompactTokenLimitScope: "total",
      },
    });

    recordCompactionStarted(session, {
      id: "compact-recycle-provider",
      timestamp: 1000,
      trigger: "auto",
      cause: "unknown",
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      before: {
        contextTokensUsed: 525_000,
        providerReportedInputTokens: 518_000,
        providerReportedTotalTokens: 525_000,
        modelContextWindow: 2_876_389,
        contextUsedPercent: 18,
        source: "codex_token_details",
      },
    });
  });

  it.each([
    ["manual", "manual", "takode_manual_request"],
    ["model_switch_migration", "auto", "takode_model_switch_guard"],
    ["unknown", "auto", undefined],
  ] as const)("keeps %s snapshots on observed provider accounting", (cause, trigger, causeSource) => {
    const session = makeSession(configuredCodexState());

    recordCompactionStarted(session, {
      id: `compact-${cause}`,
      timestamp: 1000,
      trigger,
      cause: cause as CodexCompactionCause,
      ...(causeSource ? { causeSource } : {}),
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger,
      cause,
      ...(causeSource ? { causeSource } : {}),
      before: {
        contextTokensUsed: 470_000,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 62,
        modelContextWindow: 760_000,
        source: "codex_token_details",
      },
    });
  });

  it("prefers provider total for an after snapshot and rejects stale totals even when prompt input fell", () => {
    // Post-compaction token updates can arrive out of order. When both sides
    // report provider totals, those totals decide whether the snapshot is new;
    // prompt input is only the fallback comparison.
    const session = makeSession({
      context_used_percent: 90,
      codex_token_details: {
        contextTokensUsed: 270_000,
        providerReportedTotalTokens: 275_000,
        inputTokens: 300_000,
        outputTokens: 10_000,
        cachedInputTokens: 30_000,
        reasoningOutputTokens: 5_000,
        modelContextWindow: 300_000,
      },
    });

    recordCompactionStarted(session, { id: "compact-boundary-1", timestamp: 1000 });
    session.state.codex_token_details = {
      ...session.state.codex_token_details!,
      contextTokensUsed: 95_000,
      providerReportedTotalTokens: 280_000,
    };
    recordCompactionFinished(session, 2000);

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      before: { contextTokensUsed: 275_000, providerReportedTotalTokens: 275_000 },
      finishedAt: 2000,
    });
    expect(session.state.lifecycle_events?.[0]).not.toHaveProperty("after");

    session.state.codex_token_details = {
      ...session.state.codex_token_details,
      contextTokensUsed: 95_000,
      providerReportedTotalTokens: 100_000,
    };
    recordCompactionStarted(session, { id: "compact-boundary-2", timestamp: 3000 });
    session.state.codex_token_details = {
      ...session.state.codex_token_details,
      contextTokensUsed: 20_000,
      providerReportedTotalTokens: 25_000,
    };
    recordCompactionFinished(session, 4000);

    expect(session.state.lifecycle_events?.[1]).toMatchObject({
      before: { contextTokensUsed: 100_000, providerReportedTotalTokens: 100_000 },
      after: {
        contextTokensUsed: 25_000,
        providerReportedInputTokens: 20_000,
        providerReportedTotalTokens: 25_000,
        source: "codex_token_details",
      },
      finishedAt: 4000,
    });
  });
});
