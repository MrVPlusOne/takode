import type {
  BrowserOutgoingMessage,
  PausedInboundMessage,
  PausedInboundSource,
  SessionPauseState,
  SessionState,
  TakodeHerdBatchSnapshot,
  ThreadRef,
} from "./session-types.js";

export type PausedDelivery = "paused_queued";

export interface PauseableSession {
  id: string;
  state: SessionState;
}

export interface ProgrammaticPauseMessageInput {
  content: string;
  agentSource?: { sessionId: string; sessionLabel?: string };
  takodeHerdBatch?: TakodeHerdBatchSnapshot;
  threadRoute?: { threadKey: string; questId?: string; threadRefs?: ThreadRef[] };
  options?: {
    deliveryContent?: Extract<BrowserOutgoingMessage, { type: "user_message" }>["deliveryContent"];
    replyContext?: Extract<BrowserOutgoingMessage, { type: "user_message" }>["replyContext"];
    sessionId?: string;
    vscodeSelection?: Extract<BrowserOutgoingMessage, { type: "user_message" }>["vscodeSelection"];
  };
}

export function isSessionPaused(session: PauseableSession | null | undefined): boolean {
  return !!session?.state.pause?.pausedAt;
}

export function getPauseState(session: PauseableSession | null | undefined): SessionPauseState | null {
  return session?.state.pause ?? null;
}

export function getPausedQueueCount(session: PauseableSession | null | undefined): number {
  return getPauseState(session)?.queuedMessages.length ?? 0;
}

export function pauseSessionState(
  session: PauseableSession,
  options: { pausedBy?: string; reason?: string } = {},
): SessionPauseState {
  const existing = session.state.pause;
  const pause: SessionPauseState = {
    pausedAt: existing?.pausedAt ?? Date.now(),
    queuedMessages: existing?.queuedMessages ?? [],
    ...(options.pausedBy ? { pausedBy: options.pausedBy } : existing?.pausedBy ? { pausedBy: existing.pausedBy } : {}),
    ...(options.reason ? { reason: options.reason } : existing?.reason ? { reason: existing.reason } : {}),
    ...(existing?.lastQueuedAt ? { lastQueuedAt: existing.lastQueuedAt } : {}),
  };
  session.state.pause = pause;
  return pause;
}

export function unpauseSessionState(session: PauseableSession): PausedInboundMessage[] {
  const queued = session.state.pause?.queuedMessages ?? [];
  session.state.pause = null;
  return queued;
}

export function buildPausedDiagnostic(session: PauseableSession): string {
  const count = getPausedQueueCount(session);
  const suffix = count === 1 ? "1 held input" : `${count} held inputs`;
  return `Session is paused. New work is held until unpause (${suffix}).`;
}

export function isComposerUserMessage(
  session: PauseableSession,
  message: Extract<BrowserOutgoingMessage, { type: "user_message" }>,
): boolean {
  return (
    message.inputSource === "composer" &&
    (!message.session_id || message.session_id === session.id) &&
    !message.images?.length
  );
}

export function canQueuePausedUserMessage(message: Extract<BrowserOutgoingMessage, { type: "user_message" }>): boolean {
  return !message.images?.length;
}

export function queuePausedUserMessage(
  session: PauseableSession,
  source: PausedInboundSource,
  message: Extract<BrowserOutgoingMessage, { type: "user_message" }>,
): PausedInboundMessage | null {
  const pause = session.state.pause;
  if (!pause || !canQueuePausedUserMessage(message)) return null;
  const queued: PausedInboundMessage = {
    id: `paused-${Date.now()}-${pause.queuedMessages.length + 1}`,
    queuedAt: Date.now(),
    source,
    message,
  };
  pause.queuedMessages.push(queued);
  pause.lastQueuedAt = queued.queuedAt;
  return queued;
}

export function buildProgrammaticUserMessage(
  input: ProgrammaticPauseMessageInput,
): Extract<BrowserOutgoingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    content: input.content,
    ...(input.options?.deliveryContent ? { deliveryContent: input.options.deliveryContent } : {}),
    ...(input.options?.replyContext ? { replyContext: input.options.replyContext } : {}),
    ...(input.options?.sessionId ? { session_id: input.options.sessionId } : {}),
    ...(input.options?.vscodeSelection ? { vscodeSelection: input.options.vscodeSelection } : {}),
    ...(input.agentSource ? { agentSource: input.agentSource } : {}),
    ...(input.takodeHerdBatch ? { takodeHerdBatch: input.takodeHerdBatch } : {}),
    ...(input.threadRoute ? { threadKey: input.threadRoute.threadKey } : {}),
    ...(input.threadRoute?.questId ? { questId: input.threadRoute.questId } : {}),
    ...(input.threadRoute?.threadRefs?.length ? { threadRefs: input.threadRoute.threadRefs } : {}),
  };
}
