import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { getMessageThreadKey, getMessageThreadLinkKey } from "./MessageThreadHeader.js";

// A message belongs to one thread: the one it was written in. Thread
// references added later (handoffs) or for visibility (attachments, shared
// answers) never move it. Field shapes follow what the server persists.

function message(metadata: ChatMessage["metadata"]): ChatMessage {
  return { id: "m", role: "assistant", content: "x", timestamp: 1, metadata };
}

describe("getMessageThreadKey", () => {
  it("uses an answer's authored thread over its Main display route", () => {
    // Answer routing stores an answer with a Main request as `threadKey: main`
    // plus a backfill ref to the authoring quest.
    const answer = message({
      threadKey: "main",
      threadRefs: [{ threadKey: "q-2289", questId: "q-2289", source: "backfill" }],
      threadAnswer: {
        version: 2,
        answerUserMessageIds: ["u32"],
        observedHistoryLength: 3,
        authoredThreadKey: "q-2289",
      },
    });
    expect(getMessageThreadKey(answer)).toBe("q-2289");
  });

  it("keeps a handed-off request in the thread it was sent in", () => {
    const handedOff = message({
      threadKey: "main",
      threadRefs: [{ threadKey: "q-2289", questId: "q-2289", source: "explicit", attachedAt: 5 }],
    });
    expect(getMessageThreadKey(handedOff)).toBe("main");
  });

  it("uses the first routed reference when a message has no stored route", () => {
    const routed = message({
      threadRefs: [
        { threadKey: "q-941", questId: "q-941", source: "explicit" },
        { threadKey: "q-942", questId: "q-942", source: "explicit" },
      ],
    });
    expect(getMessageThreadKey(routed)).toBe("q-941");
  });

  it("treats an attached route-less leader message as Main", () => {
    const attached = message({ threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "backfill" }] });
    expect(getMessageThreadKey(attached)).toBe("main");
  });

  it("gives messages without thread metadata no thread", () => {
    expect(getMessageThreadKey(message(undefined))).toBeNull();
    expect(getMessageThreadKey(message({}))).toBeNull();
  });
});

describe("getMessageThreadLinkKey", () => {
  const questMessage = message({ threadKey: "q-7", questId: "q-7" });

  it("links only when the message belongs to another thread", () => {
    expect(getMessageThreadLinkKey(questMessage, "q-7")).toBeNull();
    expect(getMessageThreadLinkKey(questMessage, "main")).toBe("q-7");
  });

  it("always links in All Threads, which has no single selected thread", () => {
    expect(getMessageThreadLinkKey(questMessage, "all")).toBe("q-7");
    expect(getMessageThreadLinkKey(questMessage)).toBe("q-7");
  });
});
