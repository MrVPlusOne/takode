import { describe, expect, it, vi } from "vitest";
import { finalizeCodexRollback } from "./session-registry-controller.js";

function makeSession() {
  return {
    id: "session-codex-revert",
    pendingCodexRollback: { numTurns: 1, truncateIdx: 2, clearCodexState: true },
    pendingCodexRollbackError: "stale error",
    pendingCodexRollbackWaiter: { resolve: vi.fn(), reject: vi.fn() },
  } as any;
}

function makeDeps() {
  return {
    recomputeAndBroadcastHistoryBytes: vi.fn(),
    persistSessionSync: vi.fn(),
    refreshSessionConversation: vi.fn(),
    broadcastToSession: vi.fn(),
  };
}

describe("finalizeCodexRollback", () => {
  it("refreshes subscribed bounded conversations after a successful rollback", () => {
    const session = makeSession();
    const waiter = session.pendingCodexRollbackWaiter;
    const revertedSession = { messageHistory: [{ type: "user_message", content: "retained" }] } as any;
    const deps = makeDeps();

    finalizeCodexRollback(session, deps, revertedSession);

    expect(session.pendingCodexRollback).toBeNull();
    expect(session.pendingCodexRollbackError).toBeNull();
    expect(session.pendingCodexRollbackWaiter).toBeNull();
    expect(waiter.resolve).toHaveBeenCalledOnce();
    expect(deps.recomputeAndBroadcastHistoryBytes).toHaveBeenCalledWith(session);
    expect(deps.persistSessionSync).toHaveBeenCalledWith(session.id);
    expect(deps.refreshSessionConversation).toHaveBeenCalledWith(session.id);
    expect(deps.broadcastToSession).toHaveBeenCalledOnce();
    expect(deps.broadcastToSession).toHaveBeenCalledWith(session.id, { type: "status_change", status: "idle" });
  });

  it("settles rollback bookkeeping without refreshing when no reverted session exists", () => {
    const session = makeSession();
    const waiter = session.pendingCodexRollbackWaiter;
    const deps = makeDeps();

    finalizeCodexRollback(session, deps, null);

    expect(session.pendingCodexRollback).toBeNull();
    expect(session.pendingCodexRollbackError).toBeNull();
    expect(session.pendingCodexRollbackWaiter).toBeNull();
    expect(waiter.resolve).toHaveBeenCalledOnce();
    expect(deps.recomputeAndBroadcastHistoryBytes).not.toHaveBeenCalled();
    expect(deps.persistSessionSync).not.toHaveBeenCalled();
    expect(deps.refreshSessionConversation).not.toHaveBeenCalled();
    expect(deps.broadcastToSession).not.toHaveBeenCalled();
  });
});
