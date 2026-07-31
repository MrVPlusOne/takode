import { describe, expect, it, vi } from "vitest";
import type {
  BrowserIncomingMessage,
  CodexAutoPauseHeldInput,
  CodexResultErrorAutoPauseState,
} from "../session-types.js";
import {
  createCodexAutoPauseRecoverySummary,
  markCodexAutoPauseRecoveryDiscarded,
  markCodexAutoPauseRecoveryDelivered,
  markCodexAutoPauseRecoverySuppressed,
  markCodexAutoPauseRecoveryTurnCompleted,
} from "./codex-auto-pause-recovery-summary.js";
import { pruneStalePendingCodexHerdInputs } from "./board-watchdog-controller.js";

function heldInput(
  id: string,
  event: "turn_end" | "board_stalled",
  content: string,
  count = 1,
): CodexAutoPauseHeldInput {
  return {
    id,
    queuedAt: 110,
    lastQueuedAt: 120,
    source: "programmatic",
    count,
    message: {
      type: "user_message",
      content,
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      threadKey: "q-42",
      questId: "q-42",
      takodeHerdBatch: {
        events: [
          {
            id: 1,
            event,
            sessionId: "worker",
            ts: 100,
            data:
              event === "board_stalled"
                ? { questId: "q-42", stage: "IMPLEMENTING", reason: "worker disconnected" }
                : { reason: "result", duration_ms: 100 },
          } as any,
        ],
        renderedLines: [content],
      },
    },
  };
}

function pauseState(heldInputs: CodexAutoPauseHeldInput[]): CodexResultErrorAutoPauseState {
  return {
    family: "copilot_auth_refresh_exhausted",
    fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
    streak: 1,
    threshold: 1,
    pausedAt: 100,
    lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
    lastErrorAt: 100,
    lastSourceKind: "automatic",
    totalMatchingErrors: 1,
    heldInputs,
  };
}

describe("Codex auto-pause recovery summary", () => {
  it("creates one bounded producer-shaped receipt projection before drain", () => {
    // Receipts must distinguish the two real incident event kinds without retaining their payloads or auth text.
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const turnEnd = heldInput("group-turn", "turn_end", "private turn payload sentinel", 2);
    const boardStalled = heldInput("group-board", "board_stalled", "private board payload sentinel");

    const entry = createCodexAutoPauseRecoverySummary(
      session,
      pauseState([turnEnd, boardStalled]),
      [turnEnd, boardStalled],
      200,
      { broadcastToBrowsers },
    );

    expect(session.messageHistory).toEqual([entry]);
    expect(entry).toMatchObject({
      type: "codex_auto_pause_recovery_summary",
      id: "codex-auto-pause-recovery-100",
      threadKey: "q-42",
      questId: "q-42",
      content: "Automatic input recovery: 2 awaiting delivery.",
    });
    expect(entry.recovery.receipts).toEqual([
      expect.objectContaining({
        groupId: "group-turn",
        sourceLabel: "Herd Events",
        sourceDetail: "turn_end",
        count: 2,
        coalescedCount: 1,
        survivingGroupId: "group-turn",
        outcome: "released_to_delivery",
      }),
      expect.objectContaining({ groupId: "group-board", sourceDetail: "board_stalled", count: 1 }),
    ]);
    expect(entry.searchText).toContain("detail:turn_end");
    expect(entry.searchText).toContain("detail:board_stalled");
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("private turn payload sentinel");
    expect(serialized).not.toContain("private board payload sentinel");
    expect(serialized).not.toContain("github_copilot");
    expect(broadcastToBrowsers).toHaveBeenCalledOnce();

    // Replaying summary creation for the same pause is idempotent and does not append or rebroadcast.
    expect(
      createCodexAutoPauseRecoverySummary(session, pauseState([turnEnd]), [turnEnd], 201, { broadcastToBrowsers }),
    ).toBe(entry);
    expect(session.messageHistory).toHaveLength(1);
    expect(broadcastToBrowsers).toHaveBeenCalledOnce();
  });

  it("bounds and sanitizes source labels without retaining full payload text", () => {
    // Receipt metadata may identify a source, but it must not become an unbounded log or payload copy.
    const input: CodexAutoPauseHeldInput = {
      id: "group-bounded",
      queuedAt: 1,
      lastQueuedAt: 1,
      source: "programmatic",
      count: 1,
      message: {
        type: "user_message",
        content: "full private payload sentinel",
        agentSource: { sessionId: "agent", sessionLabel: `unsafe\napi_key=credential-sentinel ${"x".repeat(120)}` },
      },
    };
    const entry = createCodexAutoPauseRecoverySummary({ messageHistory: [] }, pauseState([input]), [input], 2, {
      broadcastToBrowsers: vi.fn(),
    });

    expect(entry.recovery.receipts[0]?.sourceLabel.length).toBeLessThanOrEqual(64);
    expect(entry.recovery.receipts[0]?.sourceLabel).not.toMatch(/[\n\r]/u);
    expect(entry.recovery.receipts[0]?.sourceLabel).not.toContain("credential-sentinel");
    expect(entry.searchText.length).toBeLessThanOrEqual(2_048);
    expect(entry.searchText).not.toContain("credential-sentinel");
    expect(JSON.stringify(entry)).not.toContain("full private payload sentinel");
  });

  it("updates one summary through delivered/recovered and stale-suppressed terminal outcomes", () => {
    // This reproduces the accepted incident contract: turn_end reaches Codex after recovery; board_stalled is stale.
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const inputs = [
      heldInput("group-turn", "turn_end", "turn payload"),
      heldInput("group-board", "board_stalled", "board payload"),
    ];
    const entry = createCodexAutoPauseRecoverySummary(session, pauseState(inputs), inputs, 200, {
      broadcastToBrowsers,
    });
    const turnLink = { summaryId: entry.id, groupId: "group-turn" };
    const boardLink = { summaryId: entry.id, groupId: "group-board" };

    expect(markCodexAutoPauseRecoveryDelivered(session, [turnLink], 210, { broadcastToBrowsers })).toBe(true);
    expect(
      markCodexAutoPauseRecoverySuppressed(session, [boardLink], 220, { broadcastToBrowsers }, "stale_board_state"),
    ).toBe(true);
    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [turnLink], dispatchCount: 2 },
        false,
        false,
        230,
        { broadcastToBrowsers },
      ),
    ).toBe(true);

    expect(entry.recovery.status).toBe("settled");
    expect(entry.content).toBe("Automatic input recovery: 1 delivered, 1 suppressed.");
    expect(entry.searchText).toContain("outcome:delivered");
    expect(entry.searchText).toContain("completion:recovered");
    expect(entry.searchText).toContain("reason_code:stale_board_state");
    expect(entry.recovery.receipts).toEqual([
      expect.objectContaining({
        groupId: "group-turn",
        outcome: "delivered",
        reasonCode: "codex_delivery_recovered",
        recovered: true,
        terminalAt: 210,
        completedAt: 230,
      }),
      expect.objectContaining({
        groupId: "group-board",
        outcome: "suppressed",
        reasonCode: "stale_board_state",
        terminalAt: 220,
      }),
    ]);

    // Terminal decisions and completion enrichment are replay-idempotent.
    const calls = broadcastToBrowsers.mock.calls.length;
    expect(markCodexAutoPauseRecoveryDelivered(session, [turnLink], 240, { broadcastToBrowsers })).toBe(false);
    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [turnLink], dispatchCount: 2 },
        false,
        false,
        250,
        { broadcastToBrowsers },
      ),
    ).toBe(false);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(calls);
  });

  it("finalizes an interrupted delivered turn without completion enrichment or replay mutation", () => {
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const input = heldInput("group-interrupted", "turn_end", "private interrupted payload");
    const entry = createCodexAutoPauseRecoverySummary(session, pauseState([input]), [input], 200, {
      broadcastToBrowsers,
    });
    const link = { summaryId: entry.id, groupId: input.id };
    expect(markCodexAutoPauseRecoveryDelivered(session, [link], 210, { broadcastToBrowsers })).toBe(true);

    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [link], dispatchCount: 2 },
        false,
        true,
        220,
        { broadcastToBrowsers },
      ),
    ).toBe(true);
    expect(entry.recovery.receipts[0]).toMatchObject({
      outcome: "delivered",
      reasonCode: "codex_delivery_accepted",
      terminalAt: 210,
      finalizedAt: 220,
      finalityReason: "turn_interrupted_or_cancelled",
    });
    expect(entry.recovery.receipts[0]?.completedAt).toBeUndefined();
    expect(entry.recovery.receipts[0]?.recovered).toBeUndefined();
    expect(entry.searchText).toContain("completion:interrupted_or_cancelled");
    expect(JSON.stringify(entry)).not.toContain("private interrupted payload");

    const calls = broadcastToBrowsers.mock.calls.length;
    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [link], dispatchCount: 2 },
        false,
        true,
        230,
        { broadcastToBrowsers },
      ),
    ).toBe(false);
    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [link], dispatchCount: 2 },
        false,
        false,
        240,
        { broadcastToBrowsers },
      ),
    ).toBe(false);
    expect(entry.recovery.receipts[0]?.finalizedAt).toBe(220);
    expect(entry.recovery.receipts[0]?.completedAt).toBeUndefined();
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(calls);
  });

  it("does not create finality for an interrupted probe whose held receipt was never delivered", () => {
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const input = heldInput("group-still-held", "turn_end", "still held payload");
    const entry = createCodexAutoPauseRecoverySummary(session, pauseState([input]), [input], 200, {
      broadcastToBrowsers,
    });
    const link = { summaryId: entry.id, groupId: input.id };
    const calls = broadcastToBrowsers.mock.calls.length;

    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [link], dispatchCount: 1 },
        false,
        true,
        210,
        { broadcastToBrowsers },
      ),
    ).toBe(false);
    expect(entry.recovery.receipts[0]).toMatchObject({ outcome: "released_to_delivery" });
    expect(entry.recovery.receipts[0]?.finalizedAt).toBeUndefined();
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(calls);
  });

  it("reconciles same-pause retry groups and counts without regressing terminal receipts", () => {
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const terminal = heldInput("group-terminal", "turn_end", "terminal private payload");
    const released = heldInput("group-released", "board_stalled", "released private payload");
    const entry = createCodexAutoPauseRecoverySummary(
      session,
      pauseState([terminal, released]),
      [terminal, released],
      200,
      {
        broadcastToBrowsers,
      },
    );
    const terminalLink = { summaryId: entry.id, groupId: terminal.id };
    expect(markCodexAutoPauseRecoveryDelivered(session, [terminalLink], 210, { broadcastToBrowsers })).toBe(true);
    expect(
      markCodexAutoPauseRecoveryTurnCompleted(
        session,
        { autoPauseRecoveryLinks: [terminalLink], dispatchCount: 2 },
        false,
        false,
        220,
        { broadcastToBrowsers },
      ),
    ).toBe(true);
    const terminalBeforeRetry = structuredClone(entry.recovery.receipts[0]);

    const terminalCurrent = {
      ...heldInput("group-terminal", "board_stalled", "changed terminal private payload", 9),
      queuedAt: 300,
      lastQueuedAt: 310,
    };
    const releasedCurrent = {
      ...heldInput("group-released", "turn_end", "latest released private payload", 3),
      queuedAt: 110,
      lastQueuedAt: 330,
      message: {
        ...heldInput("group-released", "turn_end", "latest released private payload", 3).message,
        threadKey: "q-99",
        questId: "q-99",
      },
    };
    const newcomer = {
      ...heldInput("group-new", "board_stalled", "new private payload", 2),
      queuedAt: 340,
      lastQueuedAt: 350,
      message: {
        ...heldInput("group-new", "board_stalled", "new private payload", 2).message,
        threadKey: "q-100",
        questId: "q-100",
      },
    };
    const callsBeforeRetry = broadcastToBrowsers.mock.calls.length;

    expect(
      createCodexAutoPauseRecoverySummary(
        session,
        pauseState([terminalCurrent, releasedCurrent, newcomer]),
        [terminalCurrent, releasedCurrent, newcomer],
        400,
        { broadcastToBrowsers },
      ),
    ).toBe(entry);

    expect(session.messageHistory).toHaveLength(1);
    expect(entry.recovery.receipts).toHaveLength(3);
    expect(new Set(entry.recovery.receipts.map((receipt) => receipt.groupId)).size).toBe(3);
    expect(entry.recovery.receipts.find((receipt) => receipt.groupId === terminal.id)).toEqual(terminalBeforeRetry);
    expect(entry.recovery.receipts.find((receipt) => receipt.groupId === released.id)).toMatchObject({
      count: 3,
      coalescedCount: 2,
      survivingGroupId: released.id,
      queuedAt: 110,
      lastQueuedAt: 330,
      sourceDetail: "turn_end",
      outcome: "released_to_delivery",
      releasedAt: 200,
    });
    expect(entry.recovery.receipts.find((receipt) => receipt.groupId === newcomer.id)).toMatchObject({
      count: 2,
      coalescedCount: 1,
      outcome: "released_to_delivery",
      releasedAt: 400,
    });
    expect(entry.threadRefs?.map((ref) => ref.threadKey)).toEqual(expect.arrayContaining(["q-42", "q-99", "q-100"]));
    expect(entry.content).toBe("Automatic input recovery: 1 delivered, 2 awaiting delivery.");
    expect(entry.searchText).toContain("count:3");
    expect(entry.searchText).toContain("count:2");
    expect(JSON.stringify(entry)).not.toContain("private payload");
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(callsBeforeRetry + 1);

    createCodexAutoPauseRecoverySummary(
      session,
      pauseState([terminalCurrent, releasedCurrent, newcomer]),
      [terminalCurrent, releasedCurrent, newcomer],
      410,
      { broadcastToBrowsers },
    );
    expect(entry.recovery.receipts).toHaveLength(3);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  });

  it("survives a persistence round trip and settles from retained correlation links", () => {
    // Restart safety depends on both the mutable history entry and pending-delivery links being JSON-persisted.
    const original = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();
    const input = heldInput("group-restart", "turn_end", "payload excluded from receipt");
    const entry = createCodexAutoPauseRecoverySummary(original, pauseState([input]), [input], 200, {
      broadcastToBrowsers,
    });
    const persisted = JSON.parse(
      JSON.stringify({
        messageHistory: original.messageHistory,
        link: { summaryId: entry.id, groupId: input.id },
      }),
    ) as { messageHistory: BrowserIncomingMessage[]; link: { summaryId: string; groupId: string } };

    expect(markCodexAutoPauseRecoveryDelivered(persisted, [persisted.link], 300, { broadcastToBrowsers })).toBe(true);
    const recovered = persisted.messageHistory[0];
    expect(recovered?.type).toBe("codex_auto_pause_recovery_summary");
    if (recovered?.type === "codex_auto_pause_recovery_summary") {
      expect(recovered.recovery.receipts[0]).toMatchObject({ outcome: "delivered", terminalAt: 300 });
    }
  });

  it("uses discarded only for an explicit cancellation", () => {
    // The discarded terminal vocabulary is reserved for a deliberate policy action, not stale or recoverable work.
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const input = heldInput("group-cancelled", "turn_end", "cancelled payload");
    const entry = createCodexAutoPauseRecoverySummary(session, pauseState([input]), [input], 200, {
      broadcastToBrowsers: vi.fn(),
    });

    expect(
      markCodexAutoPauseRecoveryDiscarded(session, [{ summaryId: entry.id, groupId: input.id }], 210, {
        broadcastToBrowsers: vi.fn(),
      }),
    ).toBe(true);
    expect(entry.recovery.receipts[0]).toMatchObject({
      outcome: "discarded",
      reasonCode: "explicit_cancel",
      terminalAt: 210,
    });
  });

  it("records authoritative stale-board pruning instead of letting a released row vanish", () => {
    // The incident's second row was removed by board-state validation before dispatch, so pruning owns its receipt.
    const messageHistory: BrowserIncomingMessage[] = [];
    const broadcastToBrowsers = vi.fn();
    const input = heldInput("group-stale-board", "board_stalled", "stale board payload");
    const summary = createCodexAutoPauseRecoverySummary({ messageHistory }, pauseState([input]), [input], 200, {
      broadcastToBrowsers,
    });
    const session = {
      id: "leader",
      messageHistory,
      board: new Map(),
      pendingCodexInputs: [
        {
          id: "pending-stale-board",
          content: "stale board payload",
          timestamp: 200,
          cancelable: true,
          takodeHerdBatch: input.message.takodeHerdBatch,
          autoPauseRecoveries: [{ summaryId: summary.id, groupId: input.id }],
        },
      ],
    } as any;
    const persistSession = vi.fn();

    expect(
      pruneStalePendingCodexHerdInputs(session, "incident_before_dispatch", { emitTakodeEvent: vi.fn() } as any, {
        broadcastToBrowsers,
        broadcastPendingCodexInputs: vi.fn(),
        rebuildQueuedCodexPendingStartBatch: vi.fn(),
        persistSession,
      }),
    ).toBe(true);

    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(summary.recovery).toMatchObject({
      status: "settled",
      receipts: [expect.objectContaining({ outcome: "suppressed", reasonCode: "stale_board_state" })],
    });
    expect(persistSession).toHaveBeenCalledWith(session);
  });
});
