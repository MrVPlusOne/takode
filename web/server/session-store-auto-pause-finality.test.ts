import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeHistoryMessagesSyncHash } from "../shared/history-sync-hash.js";
import { markCodexAutoPauseRecoveryTurnCompleted } from "./bridge/codex-auto-pause-recovery-summary.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SessionStore interrupted recovery finality", () => {
  it("freezes and hashes an interrupted delivered receipt through explicit immutable finality", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "takode-interrupted-recovery-finality-"));
    tempDirs.push(tempDir);
    const store = new SessionStore(tempDir);
    const sessionId = "interrupted-auto-pause-recovery";
    const summary = {
      type: "codex_auto_pause_recovery_summary",
      id: "interrupted-recovery-summary",
      timestamp: 3,
      content: "Automatic input recovery: 1 delivered.",
      searchText: "automatic input recovery outcome:delivered completion:pending",
      recovery: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 1,
        recoveryConfirmedAt: 2,
        updatedAt: 3,
        status: "settled",
        receipts: [
          {
            groupId: "interrupted-group",
            source: "programmatic",
            sourceLabel: "Herd Events",
            count: 1,
            coalescedCount: 0,
            queuedAt: 1,
            lastQueuedAt: 1,
            releasedAt: 2,
            terminalAt: 3,
            outcome: "delivered",
            reasonCode: "codex_delivery_accepted",
            reason: "Accepted by Codex exactly once.",
          },
        ],
      },
      threadKey: "q-interrupted",
      questId: "q-interrupted",
      threadRefs: [{ threadKey: "q-interrupted", questId: "q-interrupted", source: "explicit" }],
    } as BrowserIncomingMessage;
    const messages = [
      { type: "user_message", id: "u1", content: "probe", timestamp: 1 },
      { type: "result", data: { is_error: false } },
      summary,
      { type: "user_message", id: "u2", content: "later work", timestamp: 4 },
      { type: "result", data: { is_error: false, stop_reason: "interrupted" } },
    ] as BrowserIncomingMessage[];
    const session = {
      id: sessionId,
      state: { session_id: sessionId },
      messageHistory: messages,
      pendingMessages: [],
      pendingPermissions: [],
    } as unknown as PersistedSession;
    const pendingHash = computeHistoryMessagesSyncHash(messages).hash;

    store.saveSync(session);
    await store.flushAll();
    expect(JSON.parse(readFileSync(join(tempDir, `${sessionId}.json`), "utf-8"))._frozenCount).toBe(2);

    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        {
          autoPauseRecoveryLinks: [{ summaryId: "interrupted-recovery-summary", groupId: "interrupted-group" }],
          dispatchCount: 1,
        },
        false,
        true,
        5,
        { broadcastToBrowsers: vi.fn() },
      ),
    ).toBe(true);
    expect(computeHistoryMessagesSyncHash(messages).hash).not.toBe(pendingHash);

    store.saveSync(session);
    await store.flushAll();
    const reloaded = await store.load(sessionId);
    const reloadedSummary = reloaded?.messageHistory.find(
      (message) => message.type === "codex_auto_pause_recovery_summary",
    );
    expect(reloaded?._frozenCount).toBe(5);
    expect(reloadedSummary).toMatchObject({
      type: "codex_auto_pause_recovery_summary",
      threadKey: "q-interrupted",
      questId: "q-interrupted",
      recovery: {
        receipts: [
          expect.objectContaining({
            outcome: "delivered",
            reasonCode: "codex_delivery_accepted",
            finalizedAt: 5,
            finalityReason: "turn_interrupted_or_cancelled",
          }),
        ],
      },
    });
    if (reloadedSummary?.type === "codex_auto_pause_recovery_summary") {
      expect(reloadedSummary.recovery.receipts[0]?.completedAt).toBeUndefined();
      expect(reloadedSummary.recovery.receipts[0]?.recovered).toBeUndefined();
    }
  });
});
