import { describe, expect, it } from "vitest";
import type { Turn } from "../hooks/use-feed-model.js";
import type { ChatMessage } from "../types.js";
import { filterMessagesForThread } from "../utils/thread-projection.js";
import { topicThreadKey } from "../../shared/topic-thread-key.js";
import { topicQuestsOfTurns } from "./topic-feed.js";
import { getMessageThreadLinkKey } from "./MessageThreadHeader.js";

/**
 * A topic conversation marks where the feed moves to another quest. Each turn belongs to the
 * quest its messages are routed to, preferring a message's own thread over quests it mentions;
 * a turn routed to none of them continues the previous quest.
 */
function message(id: string, threadKey?: string, mentions: string[] = []): ChatMessage {
  return {
    id,
    role: "assistant",
    content: id,
    timestamp: 1,
    metadata: {
      ...(threadKey ? { threadKey, questId: threadKey } : {}),
      threadRefs: mentions.map((key) => ({ threadKey: key, questId: key, source: "explicit" as const })),
    },
  } as ChatMessage;
}

function turn(...messages: ChatMessage[]): Turn {
  return {
    id: messages[0]!.id,
    userEntry: null,
    allEntries: messages.map((msg) => ({ kind: "message", msg })),
  } as Turn;
}

describe("topic feed", () => {
  it("gives each turn its quest, preferring a message's own thread", () => {
    const quests = ["q-3", "q-12"];
    const turns = [
      turn(message("a", "q-3")),
      // An answer in q-12 that mentions q-3 belongs to q-12.
      turn(message("b", "q-12", ["q-3"])),
      turn(message("c")),
      turn(message("d", "q-3")),
    ];
    expect(topicQuestsOfTurns(turns, quests)).toEqual(["q-3", "q-12", "q-12", "q-3"]);
  });

  it("keeps live messages of any of its quests", () => {
    const messages = [message("a", "q-3"), message("b"), message("c", "q-12"), message("d", "q-99")];
    const kept = filterMessagesForThread(messages, topicThreadKey(["q-3", "q-12"])).map((item) => item.id);
    expect(kept).toEqual(["a", "c"]);
  });

  it("labels only messages of other threads, since each quest's strip names its own", () => {
    const key = topicThreadKey(["q-3", "q-12"]);
    expect(getMessageThreadLinkKey(message("a", "q-3"), key)).toBeNull();
    expect(getMessageThreadLinkKey(message("b", "main"), key)).toBe("main");
  });
});
