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

  it("records pressure at the resolved total-scope auto-compact boundary instead of the smaller provider prompt input", () => {
    // Codex may report a 61% prompt input while its total-scope compaction
    // counter has already crossed the configured 90% limit. The lifecycle row
    // must preserve both values and use the actual runtime window denominator.
    const session = makeSession(configuredCodexState());

    recordCompactionStarted(session, {
      id: "compact-pressure",
      timestamp: 1000,
      trigger: "auto",
      cause: "context_pressure",
    });

    expect(session.state.lifecycle_events?.[0]).toEqual(
      expect.objectContaining({
        trigger: "auto",
        cause: "context_pressure",
        contextWindowDiagnostics: expect.objectContaining({
          displayContextWindow: 770_000,
          autoCompactTokenLimit: 684_000,
          autoCompactTokenLimitScope: "total",
        }),
        before: {
          contextTokensUsed: 684_000,
          providerReportedInputTokens: 464_542,
          providerReportedTotalTokens: 470_000,
          contextUsedPercent: 90,
          modelContextWindow: 760_000,
          autoCompactTokenLimit: 684_000,
          autoCompactTokenLimitScope: "total",
          source: "codex_auto_compact_limit",
          capturedAt: 1000,
        },
      }),
    );
  });

  it("caps a diagnostic pressure lower bound at the actual runtime context window", () => {
    // A stale or arbitrary configured auto-compact limit must not make a
    // lifecycle snapshot claim more charged context than the provider window.
    const state = configuredCodexState();
    state.codex_context_window_diagnostics.autoCompactTokenLimit = 900_000;
    const session = makeSession(state);

    recordCompactionStarted(session, {
      id: "compact-clamped",
      timestamp: 1000,
      trigger: "auto",
      cause: "context_pressure",
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      before: {
        contextTokensUsed: 760_000,
        contextUsedPercent: 100,
        modelContextWindow: 760_000,
        autoCompactTokenLimit: 900_000,
        source: "codex_auto_compact_limit",
      },
    });
  });

  it("uses the hidden provider-effective window for an unexpected recycle-mode provider compaction", () => {
    // Recycle leaders rewrite ordinary runtime stats to the Takode display
    // budget. A provider compaction belongs to the hidden provider envelope,
    // so diagnostics must not clamp its lower bound to the display budget.
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
      cause: "context_pressure",
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      before: {
        contextTokensUsed: 2_725_000,
        providerReportedInputTokens: 518_000,
        modelContextWindow: 2_876_389,
        contextUsedPercent: 95,
        source: "codex_auto_compact_limit",
      },
    });
  });

  it.each([
    ["manual", "manual"],
    ["model_switch_migration", "auto"],
  ] as const)("keeps %s snapshots on provider-input accounting without a pressure lower bound", (cause, trigger) => {
    // Manual and migration compactions are not evidence that the provider's
    // pressure threshold fired, even when the launch diagnostics include one.
    const session = makeSession(configuredCodexState());

    recordCompactionStarted(session, {
      id: `compact-${cause}`,
      timestamp: 1000,
      trigger,
      cause: cause as CodexCompactionCause,
    });

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger,
      cause,
      before: {
        contextTokensUsed: 464_542,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 61,
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
      before: { contextTokensUsed: 270_000, providerReportedTotalTokens: 275_000 },
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
      before: { contextTokensUsed: 95_000, providerReportedTotalTokens: 100_000 },
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
