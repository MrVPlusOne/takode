import { describe, expect, it } from "vitest";
import { buildFeedModel, splitTurnsByPart, type Turn } from "../hooks/use-feed-model.js";
import { topicMemberOfMessage } from "../utils/thread-projection.js";
import type { ChatMessage } from "../types.js";
import { filterMessagesForThread } from "../utils/thread-projection.js";
import { topicViewKey } from "../../shared/topic-thread-key.js";
import { rememberTopicViewMembers } from "../utils/thread-projection.js";
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

  it("starts a quest's own turn where herd events move the conversation to it", () => {
    // Jiayi's Daily briefing topic showed "q-2856 Daily briefing: October 25" over Oct 26's
    // briefing: q-2871's work came only through herd events (a worker publishing the report),
    // and a leader's turns start only at the user's messages, so it ran on inside q-2856's turn.
    const user = (id: string, threadKey: string, herd = false): ChatMessage =>
      ({
        id,
        role: "user",
        content: herd ? `1 event from 1 session\n\n#2978 | turn_end | ${threadKey}: done` : id,
        timestamp: 1,
        metadata: { threadKey, questId: threadKey },
        ...(herd ? { agentSource: { sessionId: "herd-events", sessionLabel: "Herd" } } : {}),
      }) as ChatMessage;
    const messages = [
      user("ask", "q-2856"),
      message("oct25", "q-2856"),
      user("herd-2871", "q-2871", true),
      message("oct26-report", "q-2871"),
    ];
    const quests = ["q-2856", "q-2871"];
    const { turns } = buildFeedModel(messages, true);
    expect(turns).toHaveLength(1);
    expect(topicQuestsOfTurns(turns, quests)).toEqual(["q-2856"]);

    const split = splitTurnsByPart(turns, (msg) => topicMemberOfMessage(msg, quests), {
      leaderMode: true,
      leaderSessionMode: true,
    });
    expect(split.map((item) => item.allEntries.map((entry) => entry.kind === "message" && entry.msg.id))).toEqual([
      ["oct25"],
      ["herd-2871", "oct26-report"],
    ]);
    // The first part keeps the turn's id; the strip now changes where q-2871 starts.
    expect(split[0]!.id).toBe(turns[0]!.id);
    expect(topicQuestsOfTurns(split, quests)).toEqual(["q-2856", "q-2871"]);
  });

  it("keeps the live messages the server says belong to it, and nothing by rules of its own", () => {
    // Every live message comes with the server's list of views; a topic conversation has no
    // membership rules in the browser, so an unlisted message stays out.
    const key = topicViewKey("t1");
    const listed = (msg: ChatMessage, viewKeys: string[]) => ({ ...msg, metadata: { ...msg.metadata, viewKeys } });
    const messages = [
      listed(message("a", "q-3"), ["q-3", key]),
      listed(message("b"), ["main"]),
      listed(message("c", "q-12"), ["q-12", key]),
      message("d", "q-12"),
    ];
    expect(filterMessagesForThread(messages, key).map((item) => item.id)).toEqual(["a", "c"]);
    // A quest tab follows the same list, and old-style messages by the thread rules.
    expect(filterMessagesForThread(messages, "q-12").map((item) => item.id)).toEqual(["c", "d"]);
  });

  it("labels only messages of other threads, since each quest's strip names its own", () => {
    const key = topicViewKey("t1");
    rememberTopicViewMembers(key, ["q-3", "q-12"]);
    expect(getMessageThreadLinkKey(message("a", "q-3"), key)).toBeNull();
    expect(getMessageThreadLinkKey(message("b", "main"), key)).toBe("main");
  });
});
