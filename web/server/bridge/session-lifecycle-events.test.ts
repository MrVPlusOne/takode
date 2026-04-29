import { describe, expect, it } from "vitest";
import {
  recordCompactionBoundary,
  recordCompactionFinished,
  recordCompactionStarted,
} from "./session-lifecycle-events.js";
import type { SessionState } from "../session-types.js";

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

  it("does not invent an after context length unless a later Codex snapshot is lower than before", () => {
    // A finish event can occur before Codex sends post-compaction token usage.
    // Equal or higher values are treated as stale pre-compaction data.
    const session = makeSession({
      context_used_percent: 90,
      codex_token_details: {
        contextTokensUsed: 270_000,
        inputTokens: 300_000,
        outputTokens: 10_000,
        cachedInputTokens: 30_000,
        reasoningOutputTokens: 5_000,
        modelContextWindow: 300_000,
      },
    });

    recordCompactionStarted(session, { id: "compact-boundary-1", timestamp: 1000 });
    recordCompactionFinished(session, 2000);

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      before: { contextTokensUsed: 270_000 },
      finishedAt: 2000,
    });
    expect(session.state.lifecycle_events?.[0]).not.toHaveProperty("after");

    session.state.codex_token_details = {
      ...session.state.codex_token_details!,
      contextTokensUsed: 95_000,
    };
    recordCompactionStarted(session, { id: "compact-boundary-2", timestamp: 3000 });
    session.state.codex_token_details = {
      ...session.state.codex_token_details,
      contextTokensUsed: 20_000,
    };
    recordCompactionFinished(session, 4000);

    expect(session.state.lifecycle_events?.[1]).toMatchObject({
      before: { contextTokensUsed: 95_000 },
      after: { contextTokensUsed: 20_000 },
      finishedAt: 4000,
    });
  });
});
