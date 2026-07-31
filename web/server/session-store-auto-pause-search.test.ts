import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCodexAutoPauseRecoverySummary,
  markCodexAutoPauseRecoveryDelivered,
  markCodexAutoPauseRecoverySuppressed,
  markCodexAutoPauseRecoveryTurnCompleted,
} from "./bridge/codex-auto-pause-recovery-summary.js";
import { searchSessionDocuments } from "./session-search.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type {
  BrowserIncomingMessage,
  CodexAutoPauseHeldInput,
  CodexResultErrorAutoPauseState,
} from "./session-types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function produceSettledRecoveryHistory(): BrowserIncomingMessage[] {
  const heldInputs: CodexAutoPauseHeldInput[] = [
    {
      id: "turn-group",
      queuedAt: 11,
      lastQueuedAt: 11,
      source: "programmatic",
      count: 2,
      message: {
        type: "user_message",
        content: "private turn payload sentinel",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
        takodeHerdBatch: {
          events: [{ id: 1, event: "turn_end", sessionId: "worker", ts: 10, data: {} } as any],
          renderedLines: ["private turn payload sentinel"],
        },
      },
    },
    {
      id: "board-group",
      queuedAt: 12,
      lastQueuedAt: 12,
      source: "programmatic",
      count: 1,
      message: {
        type: "user_message",
        content: "private board payload sentinel",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
        takodeHerdBatch: {
          events: [{ id: 2, event: "board_stalled", sessionId: "worker", ts: 12, data: {} } as any],
          renderedLines: ["private board payload sentinel"],
        },
      },
    },
  ];
  const state: CodexResultErrorAutoPauseState = {
    family: "copilot_auth_refresh_exhausted",
    fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
    streak: 1,
    threshold: 1,
    pausedAt: 10,
    lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
    lastErrorAt: 10,
    lastSourceKind: "automatic",
    totalMatchingErrors: 1,
    heldInputs,
  };
  const session = { messageHistory: [] as BrowserIncomingMessage[] };
  const deps = { broadcastToBrowsers: vi.fn() };
  const summary = createCodexAutoPauseRecoverySummary(session, state, heldInputs, 20, deps);
  const turnLink = { summaryId: summary.id, groupId: "turn-group" };
  markCodexAutoPauseRecoveryDelivered(session, [turnLink], 30, deps);
  markCodexAutoPauseRecoverySuppressed(
    session,
    [{ summaryId: summary.id, groupId: "board-group" }],
    31,
    deps,
    "stale_board_state",
  );
  markCodexAutoPauseRecoveryTurnCompleted(
    session,
    { autoPauseRecoveryLinks: [turnLink], dispatchCount: 2 },
    false,
    false,
    40,
    deps,
  );
  return session.messageHistory;
}

describe("archived Codex auto-pause recovery search", () => {
  it("preserves the bounded producer search projection before and after search-only restoration", async () => {
    // Archiving must retain receipt terms without copying the held payload or raw backend failure into search data.
    const history = produceSettledRecoveryHistory();
    const summary = history[0];
    expect(summary?.type).toBe("codex_auto_pause_recovery_summary");
    if (summary?.type !== "codex_auto_pause_recovery_summary") throw new Error("missing recovery summary");
    const queries = ["board_stalled", "stale_board_state", "delivered recovered", "count:2"];
    const activeDoc = { sessionId: "recovery-session", archived: false, createdAt: 1, messageHistory: history };
    for (const query of queries) {
      expect(searchSessionDocuments([activeDoc], { query }).results[0], `active:${query}`).toMatchObject({
        matchedField: "recovery_summary",
      });
    }

    const dir = mkdtempSync(join(tmpdir(), "takode-auto-pause-search-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);
    const persisted = {
      id: "recovery-session",
      state: { session_id: "recovery-session" },
      messageHistory: history,
      pendingMessages: [],
      pendingPermissions: [],
    } as unknown as PersistedSession;
    store.saveSync(persisted);
    await store.flushAll();
    expect(await store.setArchived(persisted.id, true)).toBe(true);
    await store.flushAll();

    const searchOnly = await store.loadSearchDataOnly(persisted.id);
    expect(searchOnly?._searchDataOnly).toBe(true);
    expect(searchOnly?._searchExcerpts).toEqual([
      expect.objectContaining({ type: "recovery_summary", content: summary.searchText, id: summary.id }),
    ]);
    const archivedDoc = {
      sessionId: persisted.id,
      archived: true,
      createdAt: 1,
      searchExcerpts: searchOnly?._searchExcerpts,
    };
    for (const query of queries) {
      expect(searchSessionDocuments([archivedDoc], { query }).results[0], `archived:${query}`).toMatchObject({
        matchedField: "recovery_summary",
      });
    }
    const excerpts = JSON.stringify(searchOnly?._searchExcerpts);
    expect(excerpts).not.toContain("private turn payload sentinel");
    expect(excerpts).not.toContain("private board payload sentinel");
    expect(excerpts.length).toBeLessThanOrEqual(2_200);
  });
});
