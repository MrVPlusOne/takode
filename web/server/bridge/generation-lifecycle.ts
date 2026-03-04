import { sessionTag } from "../session-tag.js";

export type InterruptSource = "user" | "leader" | "system";

export interface GenerationLifecycleSession {
  id: string;
  isGenerating: boolean;
  generationStartedAt: number | null;
  stuckNotifiedAt: number | null;
  questStatusAtTurnStart: string | null;
  messageCountAtTurnStart: number;
  interruptedDuringTurn: boolean;
  interruptSourceDuringTurn: InterruptSource | null;
  compactedDuringTurn: boolean;
  userMessageIdsThisTurn: number[];
  optimisticRunningTimer: ReturnType<typeof setTimeout> | null;
  lastUserMessage?: string;
  state: {
    claimedQuestStatus?: string;
  };
  messageHistory: unknown[];
}

export interface GenerationLifecycleDeps<S extends GenerationLifecycleSession> {
  sessions: Map<string, S>;
  userMessageRunningTimeoutMs: number;
  broadcastStatus: (session: S, status: "running" | "idle") => void;
  persistSession: (session: S) => void;
  onSessionActivityStateChanged: (sessionId: string, reason: string) => void;
  emitTakodeEvent: (sessionId: string, type: "turn_start" | "turn_end", data: Record<string, unknown>) => void;
  buildTurnToolSummary: (session: S) => Record<string, unknown>;
  recordGenerationStarted?: (session: S, reason: string) => void;
  recordGenerationEnded?: (session: S, reason: string, elapsedMs: number) => void;
  onOrchestratorTurnEnd?: (sessionId: string) => void;
}

export function markTurnInterrupted<S extends GenerationLifecycleSession>(session: S, source: InterruptSource): void {
  if (!session.isGenerating) return;
  session.interruptedDuringTurn = true;
  session.interruptSourceDuringTurn = source;
}

export function clearOptimisticRunningTimer<S extends GenerationLifecycleSession>(session: S): void {
  if (!session.optimisticRunningTimer) return;
  clearTimeout(session.optimisticRunningTimer);
  session.optimisticRunningTimer = null;
}

function restartOptimisticRunningTimer<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  reason: string,
): void {
  clearOptimisticRunningTimer(session);
  const timer = setTimeout(() => {
    const current = deps.sessions.get(session.id);
    if (!current) return;
    if (current.optimisticRunningTimer !== timer) return;
    current.optimisticRunningTimer = null;
    if (!current.isGenerating) return;

    console.warn(
      `[ws-bridge] Reverting optimistic running state after ${deps.userMessageRunningTimeoutMs}ms for session ${sessionTag(current.id)} (${reason})`,
    );
    markTurnInterrupted(current, "system");
    setGenerating(deps, current, false, "user_message_timeout");
    deps.broadcastStatus(current, "idle");
    deps.persistSession(current);
  }, deps.userMessageRunningTimeoutMs);
  session.optimisticRunningTimer = timer;
}

export function markRunningFromUserDispatch<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  reason: string,
): void {
  const wasGenerating = session.isGenerating;
  restartOptimisticRunningTimer(deps, session, reason);
  setGenerating(deps, session, true, reason);
  if (!wasGenerating) {
    deps.broadcastStatus(session, "running");
  }
  deps.persistSession(session);
}

export function setGenerating<S extends GenerationLifecycleSession>(
  deps: GenerationLifecycleDeps<S>,
  session: S,
  generating: boolean,
  reason: string,
): void {
  if (session.isGenerating === generating) return;
  session.isGenerating = generating;
  if (generating) {
    session.generationStartedAt = Date.now();
    session.stuckNotifiedAt = null;
    session.questStatusAtTurnStart = session.state.claimedQuestStatus ?? null;
    session.messageCountAtTurnStart = session.messageHistory.length;
    session.interruptedDuringTurn = false;
    session.interruptSourceDuringTurn = null;
    session.compactedDuringTurn = false;
    session.userMessageIdsThisTurn = [];
    console.log(`[ws-bridge] Generation started for session ${sessionTag(session.id)} (${reason})`);
    deps.recordGenerationStarted?.(session, reason);

    deps.emitTakodeEvent(session.id, "turn_start", {
      reason,
      userMessage: session.lastUserMessage?.slice(0, 120),
    });
  } else {
    clearOptimisticRunningTimer(session);
    const elapsed = session.generationStartedAt ? Date.now() - session.generationStartedAt : 0;
    session.generationStartedAt = null;
    session.stuckNotifiedAt = null;
    console.log(`[ws-bridge] Generation ended for session ${sessionTag(session.id)} (${reason}, duration: ${elapsed}ms)`);
    deps.recordGenerationEnded?.(session, reason, elapsed);

    const toolSummary = deps.buildTurnToolSummary(session);
    const interrupted = session.interruptedDuringTurn;
    const interruptSource = interrupted ? (session.interruptSourceDuringTurn || "system") : null;
    const compacted = session.compactedDuringTurn;
    session.interruptedDuringTurn = false;
    session.interruptSourceDuringTurn = null;
    session.compactedDuringTurn = false;
    deps.emitTakodeEvent(session.id, "turn_end", {
      reason,
      duration_ms: elapsed,
      ...(interrupted ? { interrupted: true, interrupt_source: interruptSource } : {}),
      ...(compacted ? { compacted: true } : {}),
      ...toolSummary,
    });

    deps.onOrchestratorTurnEnd?.(session.id);
  }
  deps.onSessionActivityStateChanged(session.id, `generating:${reason}`);
}
