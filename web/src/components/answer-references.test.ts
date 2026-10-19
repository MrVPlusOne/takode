import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { allThreadsAnswerReferences, answerChromeFor } from "./answer-references.js";

function user(id: string, userMessageId: string | undefined, content = id): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: 1,
    ...(userMessageId ? { metadata: { leaderUserMessageId: userMessageId } } : {}),
  };
}

function answer(id: string, historyIndex: number, answerUserMessageIds: string[]): ChatMessage {
  return {
    id,
    role: "assistant",
    content: id,
    timestamp: 1,
    historyIndex,
    metadata: {
      leaderThreadRole: "answer",
      threadAnswer: { version: 2, answerUserMessageIds, observedHistoryLength: historyIndex },
    },
  };
}

describe("allThreadsAnswerReferences", () => {
  it("quotes loaded requests and falls back to a count when one is not loaded", () => {
    // All Threads holds a bounded window; an answer to a request outside it can
    // only say how many messages it answers.
    const references = allThreadsAnswerReferences([
      user("first", "u1", "First request"),
      user("second", "u2"),
      answer("both-loaded", 2, ["u1"]),
      answer("one-missing", 3, ["u2", "u9"]),
    ]);

    expect(references.get("both-loaded")).toMatchObject({
      answerCount: 1,
      referencedHistoryIds: ["first"],
      referencedMessages: [{ historyMessageId: "first", userMessageId: "u1", content: "First request" }],
    });
    expect(references.get("one-missing")).toEqual({
      answerCount: 2,
      referencedHistoryIds: [],
      referencedMessages: undefined,
    });
  });

  it("treats an answer whose every request is answered again later as history", () => {
    // Per-ID supersession: a later answer repeating only some IDs leaves the earlier one current.
    const references = allThreadsAnswerReferences([
      user("a", "u1"),
      user("b", "u2"),
      answer("old", 3, ["u1", "u2"]),
      answer("partial", 4, ["u2"]),
      answer("replaced", 5, ["u1"]),
      answer("newer", 6, ["u1"]),
      answer("new-result", 7, []),
    ]);

    expect([...references.keys()]).toEqual(["partial", "newer", "new-result"]);
    expect(references.get("new-result")).toMatchObject({ answerCount: 0 });
  });

  it("ignores messages without valid settled answer metadata and ambiguous request IDs", () => {
    const commentary: ChatMessage = {
      ...answer("commentary", 2, ["u1"]),
      metadata: { leaderThreadRole: "commentary" },
    };
    const timerIds = answer("timer", 3, ["timer-m1"]);
    const references = allThreadsAnswerReferences([
      user("a", "u1"),
      user("a-copy", "u1"),
      commentary,
      timerIds,
      answer("ambiguous", 4, ["u1"]),
    ]);

    expect(references.has("commentary")).toBe(false);
    expect(references.has("timer")).toBe(false);
    // A duplicated u1 proves nothing about which message it names.
    expect(references.get("ambiguous")?.referencedMessages).toBeUndefined();
  });
});

describe("answerChromeFor", () => {
  it("points up only when the one answered message is the one rendered above", () => {
    const references = allThreadsAnswerReferences([user("q", "u1"), answer("reply", 2, ["u1"])]);
    const reply = answer("reply", 2, ["u1"]);

    expect(answerChromeFor(reply, references, "q")?.answersMessageAbove).toBe(true);
    expect(answerChromeFor(reply, references, "other")?.answersMessageAbove).toBe(false);
    expect(answerChromeFor(reply, references)?.answersMessageAbove).toBe(false);
    expect(answerChromeFor(user("q", "u1"), references)).toBeNull();
  });
});
