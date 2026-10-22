import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_KEEP_ALIVE,
  nextConversationKeepAlive,
  type ConversationKeepAliveState,
} from "./conversation-keep-alive.js";

// Which conversations stay mounted, and which viewport handoff entry ids they keep. Keeping a
// conversation's ids while it is kept is what keeps its entry gates ready, so going back shows
// the mounted conversation as it was instead of rebuilding it.

function idFactory() {
  let next = 0;
  return () => `id-${++next}`;
}

function show(
  state: ConversationKeepAliveState,
  sessionId: string | null,
  createId: () => string,
  hiddenLimit = 3,
): ConversationKeepAliveState {
  return nextConversationKeepAlive(state, sessionId, hiddenLimit, createId);
}

describe("nextConversationKeepAlive", () => {
  it("keeps the shown conversation first and up to the hidden limit of recent ones after it", () => {
    const createId = idFactory();
    let state = EMPTY_CONVERSATION_KEEP_ALIVE;
    for (const sessionId of ["a", "b", "c", "d", "e"]) state = show(state, sessionId, createId);
    expect(state.kept.map((entry) => entry.sessionId)).toEqual(["e", "d", "c", "b"]);
    expect(state.activeSessionId).toBe("e");

    state = show(state, "c", createId);
    expect(state.kept.map((entry) => entry.sessionId)).toEqual(["c", "e", "d", "b"]);
  });

  it("keeps a conversation's entry ids and creation order while it is kept", () => {
    const createId = idFactory();
    let state = show(EMPTY_CONVERSATION_KEEP_ALIVE, "a", createId);
    const left = state.kept[0]!;
    state = show(state, "b", createId);
    state = show(state, null, createId);
    state = show(state, "a", createId);
    expect(state.kept[0]).toBe(left);
  });

  it("returns the same state when nothing changed, so App keeps its elements", () => {
    const createId = idFactory();
    const state = show(EMPTY_CONVERSATION_KEEP_ALIVE, "a", createId);
    expect(show(state, "a", createId)).toBe(state);
    const noneShown = show(state, null, createId);
    expect(show(noneShown, null, createId)).toBe(noneShown);
  });

  it("gives a dropped conversation new entry ids when it is shown again", () => {
    const createId = idFactory();
    let state = show(EMPTY_CONVERSATION_KEEP_ALIVE, "a", createId, 1);
    const first = state.kept[0]!;
    state = show(state, "b", createId, 1);
    state = show(state, "c", createId, 1);
    expect(state.kept.map((entry) => entry.sessionId)).toEqual(["c", "b"]);
    state = show(state, "a", createId, 1);
    expect(state.kept[0]!.sessionEntryId).not.toBe(first.sessionEntryId);
    expect(state.kept[0]!.threadScopeId).not.toBe(first.threadScopeId);
    expect(state.kept[0]!.seq).toBeGreaterThan(first.seq);
  });

  it("keeps only the hidden limit while no conversation is shown, and trims to a lower limit", () => {
    const createId = idFactory();
    let state = EMPTY_CONVERSATION_KEEP_ALIVE;
    for (const sessionId of ["a", "b", "c", "d"]) state = show(state, sessionId, createId);
    expect(show(state, null, createId).kept.map((entry) => entry.sessionId)).toEqual(["d", "c", "b"]);
    expect(show(state, "d", createId, 2).kept.map((entry) => entry.sessionId)).toEqual(["d", "c", "b"]);
    expect(show(state, "d", createId, 1).kept.map((entry) => entry.sessionId)).toEqual(["d", "c"]);
  });
});
