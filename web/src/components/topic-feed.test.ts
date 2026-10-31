import { describe, expect, it } from "vitest";
import { buildFeedModel, splitTurnsByPart, type Turn } from "../hooks/use-feed-model.js";
import { topicMemberOfMessage } from "../utils/thread-projection.js";
import type { ChatMessage } from "../types.js";
import { filterMessagesForThread } from "../utils/thread-projection.js";
import { topicViewKey } from "../../shared/topic-thread-key.js";
import { rememberTopicViewMembers } from "../utils/thread-projection.js";
import { isFinalMessage, topicQuestsOfTurns } from "./topic-feed.js";
import { topicFeedOrder, topicFeedShownEntries } from "./topic-feed-turns.js";
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

/** The part rule for messages alone, as the feed applies it without started quests. */
function partsOf(questIds: readonly string[]) {
  return (message: ChatMessage) => topicMemberOfMessage(message, questIds);
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
    expect(topicQuestsOfTurns(turns, partsOf(quests))).toEqual(["q-3", "q-12", "q-12", "q-3"]);
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
    expect(topicQuestsOfTurns(turns, partsOf(quests))).toEqual(["q-2856"]);

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
    expect(topicQuestsOfTurns(split, partsOf(quests))).toEqual(["q-2856", "q-2871"]);
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

describe("what a topic conversation shows, and in what order", () => {
  // Jiayi: the topic view showed the leader's working steps (commentary, progress, tool and worker
  // rows) and let parallel quests interleave. It now shows what the user reads, one quest at a time.
  const answer = (id: string, threadKey: string): ChatMessage => ({
    ...message(id, threadKey),
    metadata: { ...message(id, threadKey).metadata, leaderThreadRole: "answer" },
  });
  const commentary = (id: string, threadKey: string): ChatMessage => ({
    ...message(id, threadKey),
    metadata: { ...message(id, threadKey).metadata, leaderThreadRole: "commentary" },
  });
  const report = (id: string, threadKey: string): ChatMessage => ({
    ...message(id, threadKey),
    metadata: { ...message(id, threadKey).metadata, markdownReport: {} as never },
  });
  const human = (id: string, threadKey: string): ChatMessage =>
    ({
      ...message(id, threadKey),
      role: "user",
      metadata: { ...message(id, threadKey).metadata, leaderResponseCoverageVersion: 1 },
    }) as ChatMessage;
  const shownIds = (item: Turn, reveal?: string) =>
    topicFeedShownEntries(item, reveal).map((entry) => entry.kind === "message" && entry.msg.id);

  it("shows the user's messages, answers and reports, and leaves the working steps out", () => {
    const working = turn(commentary("c1", "q-1"), answer("a1", "q-1"), commentary("c2", "q-1"), report("r1", "q-1"));
    expect(shownIds(working)).toEqual(["a1", "r1"]);
    expect(shownIds(turn(commentary("c3", "q-1")))).toEqual([]);
    // A jump to a working step (a search hit, a link) shows it in place.
    expect(shownIds(working, "c2")).toEqual(["a1", "c2", "r1"]);
  });

  it("counts the user's own message as final, but not a herd event or a subagent's text", () => {
    const own = human("u", "q-1");
    expect(isFinalMessage(own)).toBe(true);
    expect(isFinalMessage({ ...own, agentSource: { sessionId: "herd-events" } } as ChatMessage)).toBe(false);
    expect(isFinalMessage({ ...answer("s", "q-1"), parentToolUseId: "tool-1" })).toBe(false);
    expect(isFinalMessage(commentary("c", "q-1"))).toBe(false);
  });

  it("follows each request with its quest's answers, keeping the requests in their order", () => {
    // Two quests asked a few minutes apart, their answers and a follow-up arriving interleaved.
    const turns = [
      turn(human("ask1", "q-1")),
      turn(human("ask2", "q-2")),
      turn(answer("ans1", "q-1")),
      turn(commentary("steps2", "q-2")),
      turn(answer("ans2", "q-2")),
      turn(message("own", "topic:aaaaaaaa")),
      turn(human("more1", "q-1")),
      turn(answer("ans-more1", "q-1")),
    ];
    const quests = topicQuestsOfTurns(turns, partsOf(["q-1", "q-2", "topic:aaaaaaaa"]));
    const order = topicFeedOrder(turns, quests, (index) => index !== 3, "topic:aaaaaaaa");
    expect(order.map((index) => turns[index]!.id)).toEqual([
      // q-1's track where its request was, its follow-up and answer included; then q-2's; the
      // topic's own message keeps its place among the tracks.
      "ask1",
      "ans1",
      "more1",
      "ans-more1",
      "ask2",
      "ans2",
      "own",
    ]);
  });

  it("starts a quest's track again on a new day, so day labels stay true", () => {
    const day = 24 * 60 * 60 * 1000;
    const at = (msg: ChatMessage, timestamp: number) => ({ ...msg, timestamp });
    const turns = [
      turn(at(human("ask1", "q-1"), 1)),
      turn(at(human("ask2", "q-2"), 2)),
      turn(at(answer("ans1", "q-1"), 1 + day)),
      turn(at(answer("ans2", "q-2"), 2 + day)),
    ];
    const quests = topicQuestsOfTurns(turns, partsOf(["q-1", "q-2"]));
    const order = topicFeedOrder(turns, quests, () => true, "topic:aaaaaaaa");
    expect(order.map((index) => turns[index]!.id)).toEqual(["ask1", "ask2", "ans1", "ans2"]);
  });
});
