import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  buildLeaderUserMessageIdentities,
  findLeaderUserMessageById,
  nextLeaderUserMessageId,
  prepareLeaderHistoryWindow,
} from "./leader-user-message-id.js";

function human(id: string, leaderUserMessageId?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: 1,
    leaderResponseCoverageVersion: 1,
    ...(leaderUserMessageId ? { leaderUserMessageId } : {}),
  };
}

describe("leader user-message IDs", () => {
  it("assigns deterministic virtual ordinals to legacy rows and continues persisted IDs", () => {
    // Older post-cutover rows remain addressable without rewriting durable history.
    const history = [human("legacy-a"), human("legacy-b"), human("new-c", "u3")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u1", "u2", "u3"]);
    expect(nextLeaderUserMessageId(history)).toBe("u4");
    expect(nextLeaderUserMessageId(history, ["u8", undefined])).toBe("u9");
    expect(findLeaderUserMessageById(history, "u2")?.historyMessageId).toBe("legacy-b");
  });

  it("fails closed on duplicate persisted IDs without losing unique session-local lookup", () => {
    // Corrupted duplicate envelopes must not resolve ambiguously or steal another row's ID.
    const history = [human("a", "u1"), human("b", "u1"), human("c", "u4")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u2", "u3", "u4"]);
    expect(findLeaderUserMessageById(history, "u1")).toBeNull();
    expect(nextLeaderUserMessageId(history)).toBe("u5");
  });

  it("never reissues a high duplicated persisted ID", () => {
    // Reservation uses every persisted ID, even when duplicate proof makes it unresolvable.
    const history = [human("a", "u100"), human("b", "u100"), human("c")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u1", "u2", "u3"]);
    expect(findLeaderUserMessageById(history, "u100")).toBeNull();
    expect(nextLeaderUserMessageId(history)).toBe("u101");
  });

  it("excludes synthetic, child-owned, and pre-cutover messages", () => {
    // Only direct root human input delivered under the new leader contract receives uN identity.
    const synthetic = { ...human("synthetic"), agentSource: { sessionId: "worker" } } as BrowserIncomingMessage;
    const child = {
      ...human("child"),
      codexSubagent: { childId: "child-1", rootTurnId: "root-turn" },
    } as BrowserIncomingMessage;
    const old = { type: "user_message", id: "old", content: "old", timestamp: 1 } as BrowserIncomingMessage;

    expect(buildLeaderUserMessageIdentities([synthetic, child, old, human("direct")])).toMatchObject([
      { userMessageId: "u1", historyMessageId: "direct" },
    ]);
  });

  it("gives a history window's human rows the IDs the whole history assigns them", () => {
    // A window holds only recent rows, but legacy rows' IDs count from the start of
    // the session, so the browser could not derive them; the window carries them.
    const history = [human("legacy-a"), human("legacy-b"), human("new-c", "u3")] as BrowserIncomingMessage[];
    const assistant = { type: "assistant", message: { id: "reply" } } as BrowserIncomingMessage;
    const window = [history[1]!, assistant, history[2]!];

    const { messages } = prepareLeaderHistoryWindow(window, [...history, assistant]);
    expect(messages.map((message) => (message.type === "user_message" ? message.leaderUserMessageId : null))).toEqual([
      "u2",
      null,
      "u3",
    ]);
    // Rows that need nothing keep their identity, and stored history is never rewritten.
    expect(messages[1]).toBe(assistant);
    expect(messages[2]).toBe(history[2]);
    expect(history[1]).not.toHaveProperty("leaderUserMessageId");
  });

  it("sends the messages a window's answers answer when they lie outside it", () => {
    // All Threads loads a bounded window; an answer to an older request still
    // needs that request's text to quote it. Requests inside the window and
    // requests no answer names are not sent.
    const older = {
      ...human("older"),
      content: "Older request",
      images: [{ imageId: "img-1", media_type: "image/png" }],
      annotations: [{ id: "c1", selectedText: "quoted", comment: "comment" }],
    } as BrowserIncomingMessage;
    const unrelated = human("unrelated");
    const recent = human("recent");
    const answer = {
      type: "assistant",
      leaderThreadRole: "answer",
      threadAnswer: { version: 2, answerUserMessageIds: ["u1", "u3"], observedHistoryLength: 3 },
      message: { id: "answer" },
    } as BrowserIncomingMessage;
    const history = [older, unrelated, recent, answer];

    const { answeredMessages } = prepareLeaderHistoryWindow([recent, answer], history);
    expect(answeredMessages).toEqual([
      {
        history_message_id: "older",
        user_message_id: "u1",
        content: "Older request",
        attachment_count: 1,
        annotations: [{ id: "c1", selectedText: "quoted", comment: "comment" }],
      },
    ]);
  });

  it("leaves windows without leader coverage rows or answers untouched", () => {
    // Worker sessions have neither, so their windows skip the history pass.
    const plain = { type: "user_message", id: "w", content: "w", timestamp: 1 } as BrowserIncomingMessage;
    const window = [plain];
    const prepared = prepareLeaderHistoryWindow(window, window);
    expect(prepared.messages).toBe(window);
    expect(prepared.answeredMessages).toEqual([]);
  });
});
