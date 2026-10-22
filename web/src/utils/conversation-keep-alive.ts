/**
 * Which recently viewed conversations stay loaded, hidden, beside the one on screen, so going
 * back to one shows it exactly as it was left (expanded reports, scroll position, open tabs)
 * instead of rebuilding it.
 */

/**
 * Hidden conversations kept beside the one on screen, on phones too: measured October 2026,
 * three typical hidden chats cost about 5 MB of heap and a long leader thread about 4,500 DOM
 * elements, while a hidden chat runs no effects at all.
 */
export const HIDDEN_CONVERSATION_LIMIT = 3;

export interface KeptConversation {
  sessionId: string;
  /** Creation order. Views render in this order so a kept view's DOM never moves. */
  seq: number;
  /**
   * Viewport handoff entry ids, fixed while the conversation is kept. A new entry would make its
   * entry gates wait for a read and remount the conversation; the conversation starts a new
   * thread entry by itself when it shows another thread.
   */
  sessionEntryId: string;
  threadScopeId: string;
}

export interface ConversationKeepAliveState {
  /** Most recently shown first; the first is the one on screen when `activeSessionId` names it. */
  kept: KeptConversation[];
  activeSessionId: string | null;
  nextSeq: number;
}

export const EMPTY_CONVERSATION_KEEP_ALIVE: ConversationKeepAliveState = {
  kept: [],
  activeSessionId: null,
  nextSeq: 0,
};

/**
 * The kept conversations after showing `activeSessionId` (null when no conversation is on
 * screen, such as the home page or a session still being created). Returns `state` itself when
 * nothing changed.
 */
export function nextConversationKeepAlive(
  state: ConversationKeepAliveState,
  activeSessionId: string | null,
  hiddenLimit: number,
  createId: () => string,
): ConversationKeepAliveState {
  const keptLimit = activeSessionId ? hiddenLimit + 1 : hiddenLimit;
  if (activeSessionId === state.activeSessionId && (!activeSessionId || state.kept[0]?.sessionId === activeSessionId)) {
    return state.kept.length <= keptLimit ? state : { ...state, kept: state.kept.slice(0, keptLimit) };
  }
  if (!activeSessionId) return { ...state, kept: state.kept.slice(0, keptLimit), activeSessionId: null };

  let nextSeq = state.nextSeq;
  const entry = state.kept.find((candidate) => candidate.sessionId === activeSessionId) ?? {
    sessionId: activeSessionId,
    seq: nextSeq++,
    sessionEntryId: createId(),
    threadScopeId: createId(),
  };
  const others = state.kept.filter((candidate) => candidate !== entry);
  return { kept: [entry, ...others].slice(0, keptLimit), activeSessionId, nextSeq };
}
