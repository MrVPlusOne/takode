import { serverWorkAdmission } from "../server-work-admission.js";
import { sessionTag } from "../session-tag.js";
import { handleClaudeNetworkWaitMessage } from "./claude-network-wait.js";

export interface ClaudeSdkAdapterLifecycleDeps {
  getOrCreateSession: (sessionId: string, backendType: "claude-sdk") => any;
  getLauncherSessionInfo: (sessionId: string) => any;
  onOrchestratorTurnEnd: (sessionId: string) => void;
  touchActivity: (sessionId: string) => void;
  clearOptimisticRunningTimer: (session: any, reason: string) => void;
  hasPendingForceCompact: (session: any) => boolean;
  broadcastToBrowsers: (session: any, msg: Record<string, unknown>) => void;
  handleSdkBrowserMessage: (session: any, msg: any) => boolean;
  refreshGitInfoThenRecomputeDiff: (session: any, options: { notifyPoller: boolean }) => void;
  persistSession: (session: any) => void;
  handleSdkPermissionRequest: (session: any, request: any) => Promise<void> | void;
  syncSideChatParent?: (session: any) => void;
  setCliSessionId: (sessionId: string, cliSessionId: string) => void;
  markTurnInterrupted: (session: any, source: "user" | "leader" | "system") => void;
  setGenerating: (session: any, generating: boolean, reason: string) => void;
  requestCliRelaunch?: (sessionId: string) => void;
  isCurrentSession: (sessionId: string, session: any) => boolean;
  onSessionActivityStateChanged: (sessionId: string, reason: string) => void;
  maxAdapterRelaunchFailures: number;
  adapterFailureResetWindowMs: number;
}

export function attachClaudeSdkAdapterLifecycle(
  sessionId: string,
  adapter: any,
  deps: ClaudeSdkAdapterLifecycleDeps,
): void {
  const session = deps.getOrCreateSession(sessionId, "claude-sdk");
  session.backendType = "claude-sdk";
  session.state.backend_type = "claude-sdk";
  if (session.claudeSdkAdapter && session.claudeSdkAdapter !== adapter) {
    const pendingAware = session.claudeSdkAdapter as any;
    if (typeof pendingAware.drainPendingOutgoing === "function") {
      for (const queuedMsg of pendingAware.drainPendingOutgoing()) {
        const raw = JSON.stringify(queuedMsg);
        const alreadyQueued = session.pendingMessages.some((queued: string) => queued === raw);
        if (!alreadyQueued) {
          session.pendingMessages.push(raw);
        }
      }
    }
    session.claudeSdkAdapter.disconnect().catch(() => {});
  }
  const launcherInfo = deps.getLauncherSessionInfo(sessionId);
  if (launcherInfo?.isWorktree) {
    session.state.is_worktree = true;
    if (launcherInfo.repoRoot) session.state.repo_root = launcherInfo.repoRoot;
  }
  if (launcherInfo?.model && !session.state.model) {
    session.state.model = launcherInfo.model;
  }
  session.claudeSdkAdapter = adapter;
  session.cliInitReceived = true;
  // Each adapter is a new Claude process: permission requests restored from disk
  // or left by a previous process can no longer be answered.
  if (session.pendingPermissions.size > 0) {
    for (const [requestId] of session.pendingPermissions) {
      deps.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: requestId });
    }
    session.pendingPermissions.clear();
    deps.persistSession(session);
  }
  const isActiveAdapter = () => session.claudeSdkAdapter === adapter && deps.isCurrentSession(sessionId, session);

  // The resume window ends once the backend has been quiet for the debounce
  // period. Restart it on every backend message so any replay finishes first.
  const scheduleResumeSettled = () => {
    if (session.cliResumingClearTimer) clearTimeout(session.cliResumingClearTimer);
    session.cliResumingClearTimer = setTimeout(() => {
      if (!isActiveAdapter()) return;
      session.cliResumingClearTimer = null;
      session.cliResuming = false;
      session.dropReplayHistoryAfterRevert = false;
      console.log(`[ws-bridge] cliResuming cleared for SDK session ${sessionTag(session.id)} — replay done`);
      const compactPending = deps.hasPendingForceCompact(session);
      session.forceCompactPending = compactPending;
      session.state.is_compacting = compactPending;
      session.awaitingCompactSummary = false;
      session.compactedDuringTurn = false;
      if (compactPending) {
        deps.broadcastToBrowsers(session, { type: "status_change", status: "compacting" });
      }
      if (session.pendingMessages.length > 0) {
        flushQueuedSdkMessages(session, adapter, `after SDK replay done for session ${sessionTag(session.id)}`);
      }
      const launcherInfoAfterReplay = deps.getLauncherSessionInfo(session.id);
      if (launcherInfoAfterReplay?.isOrchestrator) {
        deps.onOrchestratorTurnEnd(session.id);
      }
    }, 2000);
  };

  if (!!launcherInfo?.cliSessionId && session.messageHistory.length > 0) {
    session.cliResuming = true;
    // A resumed SDK process emits nothing until it receives input, so the
    // window must also close without any backend output. Otherwise input
    // queued before the relaunch (such as a restart continuation) would wait
    // forever for a replay that only that input can trigger.
    scheduleResumeSettled();
  }

  if (!session.cliResuming && session.pendingMessages.length > 0) {
    flushQueuedSdkMessages(session, adapter, `on SDK adapter attach for session ${sessionTag(sessionId)}`);
  }

  if (!session.cliResuming) {
    const orchInfo = deps.getLauncherSessionInfo(session.id);
    if (orchInfo?.isOrchestrator) {
      deps.onOrchestratorTurnEnd(session.id);
    }
  }

  adapter.onBrowserMessage((msg: any) => {
    if (!isActiveAdapter()) return;
    // Heartbeats are not activity: a stuck turn must stay detectable.
    if (msg.type === "keep_alive") return;

    deps.touchActivity(session.id);
    session.lastCliMessageAt = Date.now();
    deps.clearOptimisticRunningTimer(session, `sdk_output:${msg.type}`);

    if (session.cliResuming) scheduleResumeSettled();

    if (msg.type === "result") {
      session.consecutiveAdapterFailures = 0;
      session.lastAdapterFailureAt = null;
    }

    if (handleClaudeNetworkWaitMessage(session, msg, { broadcastToBrowsers: deps.broadcastToBrowsers })) return;

    if (msg.type === "session_init") {
      const initMsg = msg as any;
      if (initMsg.session) {
        const companionSessionId = session.state.session_id;
        const launchCwd = session.state.cwd;
        const launchPermissionMode = session.state.permissionMode;
        session.state = { ...session.state, ...initMsg.session, backend_type: "claude-sdk" };
        session.state.session_id = companionSessionId;
        if (launchCwd) {
          session.state.cwd = launchCwd;
        }
        if (launchPermissionMode) {
          session.state.permissionMode = launchPermissionMode;
        }
        if (session.state.permissionMode) {
          session.state.uiMode = session.state.permissionMode === "plan" ? "plan" : "agent";
        }
        initMsg.session = { ...initMsg.session, session_id: companionSessionId, backend_type: "claude-sdk" };
        if (launchCwd) {
          initMsg.session.cwd = launchCwd;
        }
        if (launchPermissionMode) {
          initMsg.session.permissionMode = launchPermissionMode;
        }
        if (session.state.uiMode) {
          initMsg.session.uiMode = session.state.uiMode;
        }
      }
      session.cliInitReceived = true;
      deps.refreshGitInfoThenRecomputeDiff(session, { notifyPoller: true });
      deps.persistSession(session);
      const launcherInfoAfterInit = deps.getLauncherSessionInfo(session.id);
      if (launcherInfoAfterInit?.isOrchestrator) {
        deps.onOrchestratorTurnEnd(session.id);
      }
      deps.onSessionActivityStateChanged(session.id, "system_init");
    }

    if (msg.type === "permission_request") {
      const maybe = deps.handleSdkPermissionRequest(session, (msg as any).request);
      if (maybe instanceof Promise) {
        void maybe.catch((err) => {
          console.error(`[ws-bridge] SDK auto-approval error for session ${sessionTag(session.id)}:`, err);
        });
      }
      return;
    }

    if (deps.handleSdkBrowserMessage(session, msg)) {
      deps.syncSideChatParent?.(session);
      return;
    }

    deps.broadcastToBrowsers(session, msg);
    deps.syncSideChatParent?.(session);
  });

  adapter.onSessionMeta((meta: any) => {
    if (!isActiveAdapter()) return;
    if (meta.cliSessionId) {
      deps.setCliSessionId(sessionId, meta.cliSessionId);
    }
    if (meta.model) session.state.model = meta.model;
  });

  const handleAdapterFailure = (
    reason: "sdk_disconnect" | "sdk_init_error",
    options?: { idleKilled?: boolean; error?: string },
  ): void => {
    const now = Date.now();
    if (
      session.lastAdapterFailureAt !== null &&
      now - session.lastAdapterFailureAt > deps.adapterFailureResetWindowMs
    ) {
      session.consecutiveAdapterFailures = 0;
    }
    session.lastAdapterFailureAt = now;
    session.consecutiveAdapterFailures++;
    const idleKilled = options?.idleKilled === true;
    const errorSuffix = options?.error ? `: ${options.error}` : "";
    if (reason === "sdk_init_error") {
      console.error(
        `[ws-bridge] Claude SDK adapter init failed for session ${sessionTag(sessionId)}${errorSuffix} ` +
          `(consecutive failures: ${session.consecutiveAdapterFailures})`,
      );
    } else {
      console.log(
        `[ws-bridge] Claude SDK adapter disconnected for session ${sessionTag(sessionId)}${idleKilled ? " (idle limit)" : ""} ` +
          `(consecutive failures: ${session.consecutiveAdapterFailures})`,
      );
    }
    session.claudeSdkAdapter = null;
    session.cliInitReceived = false;
    deps.markTurnInterrupted(session, "system");
    deps.setGenerating(session, false, reason);
    deps.broadcastToBrowsers(session, {
      type: "backend_disconnected",
      ...(idleKilled ? { reason: "idle_limit" } : {}),
    });
    deps.broadcastToBrowsers(session, { type: "status_change", status: "idle" });

    // Clear stale pending permissions so they don't accumulate across adapter
    // reconnects. Without this, takode answer picks the stale entry (whose
    // request_id doesn't exist in the new adapter) and silently fails to
    // unblock the worker.
    for (const [reqId] of session.pendingPermissions) {
      deps.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
    }
    if (session.pendingPermissions.size > 0) {
      session.pendingPermissions.clear();
      deps.persistSession(session);
    }

    if (
      !idleKilled &&
      deps.requestCliRelaunch &&
      session.browserSockets.size > 0 &&
      deps.isCurrentSession(sessionId, session) &&
      session.consecutiveAdapterFailures <= deps.maxAdapterRelaunchFailures
    ) {
      console.log(
        `[ws-bridge] SDK adapter disconnected for active browser; requesting relaunch for session ${sessionTag(sessionId)} (attempt ${session.consecutiveAdapterFailures}/${deps.maxAdapterRelaunchFailures})`,
      );
      deps.requestCliRelaunch(sessionId);
    } else if (session.consecutiveAdapterFailures > deps.maxAdapterRelaunchFailures) {
      console.error(
        `[ws-bridge] SDK adapter for session ${sessionTag(sessionId)} exceeded ${deps.maxAdapterRelaunchFailures} consecutive failures — stopping auto-relaunch`,
      );
      deps.broadcastToBrowsers(session, {
        type: "error",
        message: `Session stopped after ${deps.maxAdapterRelaunchFailures} consecutive launch failures. Use the relaunch button to try again.`,
      });
    }
  };

  adapter.onDisconnect(() => {
    if (!isActiveAdapter()) return;
    const idleKilled = deps.getLauncherSessionInfo(sessionId)?.killedByIdleManager;
    handleAdapterFailure("sdk_disconnect", { idleKilled });
  });

  adapter.onInitError((error: string) => {
    if (!isActiveAdapter()) return;
    handleAdapterFailure("sdk_init_error", { error });
  });

  deps.broadcastToBrowsers(session, { type: "backend_connected" });
  console.log(`[ws-bridge] Claude SDK adapter attached for session ${sessionTag(sessionId)}`);
}

function flushQueuedSdkMessages(session: any, adapter: any, reason: string): void {
  // Keep accepted input queued for the next server instead of handing it to a
  // backend that refuses dispatch during shutdown.
  if (serverWorkAdmission.isStopping()) return;
  console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) ${reason}`);
  const queued = session.pendingMessages.splice(0);
  for (const raw of queued) {
    try {
      adapter.sendBrowserMessage(fromLegacyQueuedMessage(JSON.parse(raw)));
    } catch {
      console.warn(
        `[ws-bridge] Skipping corrupt queued message for session ${sessionTag(session.id)}: ${String(raw).substring(0, 80)}`,
      );
    }
  }
}

/**
 * Sessions saved by the retired WebSocket backend queued raw CLI `user` NDJSON.
 * Convert text-only entries to the browser message the SDK adapter accepts.
 */
function fromLegacyQueuedMessage(msg: any): any {
  if (msg?.type !== "user" || typeof msg.message?.content !== "string") return msg;
  return { type: "user_message", content: msg.message.content };
}
