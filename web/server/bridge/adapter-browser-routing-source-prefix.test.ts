import { afterEach, describe, expect, it } from "vitest";
import { setTopicViewSource } from "../topic-views.js";
import { rememberThreadNumbers, resetThreadNumbersForTest } from "../../shared/topic-thread-key.js";
import {
  buildAdapterUserMessageSourcePrefix,
  buildUserMessageDeliveryPrefix,
} from "./adapter-browser-routing-source-prefix.js";
import { questSources } from "../quest-source-index.js";

/**
 * A message the user writes in a topic conversation is stored in the topic's own thread and reaches
 * the leader tagged with that thread, plus the topic's name and its quests (newest first), so it can
 * answer in the topic's thread or hand the message off to one of the quests.
 */
afterEach(() => {
  setTopicViewSource(null);
  resetThreadNumbersForTest();
});

describe("user message source tag", () => {
  const leader = () => ({ id: "leader" }) as never;
  const info = () => ({ isOrchestrator: true }) as never;

  it("names a topic thread's topic and quests", () => {
    setTopicViewSource({
      topicOf: (handle) => (handle === "8df94bcb" ? { id: "8df94bcb-8daf-4026", name: "Daily briefing" } : null),
      questsOf: (id) => (id === "8df94bcb-8daf-4026" ? ["q-3", "q-12", "q-9"] : []),
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    const prefix = buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:8df94bcb", "u7");
    expect(prefix).toMatch(
      /\[User .* id:u7\] \[thread:topic:8df94bcb\] \[topic: "Daily briefing"; quests: q-12, q-9, q-3\] $/,
    );
  });

  it("names a thread the user started as theirs, with where it started and the topic it is filed under", () => {
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "55badbba"
          ? { id: "55badbba-1111", name: "Quick question: how do…", thread: { startedFrom: "q-12" } }
          : handle === "66cafe00"
            ? { id: "66cafe00-2222", name: "Draft collapse bug", thread: { topicId: "77aa7700-3333" } }
            : handle === "77aa7700"
              ? { id: "77aa7700-3333", name: "Library and topics" }
              : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:55badbba", "u1")).toMatch(
      /\[thread:topic:55badbba\] \[user thread: "Quick question: how do…"; started from q-12\] $/,
    );
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:66cafe00", "u2")).toMatch(
      /\[thread:topic:66cafe00\] \[user thread: "Draft collapse bug"; filed under topic "Library and topics"\] $/,
    );
  });

  it("leaves a new thread's naming to the Scribe", () => {
    // Jiayi (Nov 1): the leader's Scribe names new threads now, woken at once for them, so the tag
    // no longer asks the leader to rename a thread still called by the user's first words.
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "55badbba" ? { id: "55badbba-1111", name: "Quick question: how do…", thread: {} } : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    const prefix = buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:55badbba", "u1");
    expect(prefix).toMatch(/\[user thread: "Quick question: how do…"\] $/);
    expect(prefix).not.toContain("rename");
  });

  it("tells the leader when the user answers in a thread the leader opened itself", () => {
    // The leader opened it for a proposal or question, so it knows the subject; its name is the
    // leader's own, never a placeholder to rename.
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "88beef00" ? { id: "88beef00-4444", name: "Faster eval sweeps", thread: { byLeader: true } } : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "yes", "topic:88beef00", "u3")).toMatch(
      /\[user thread: "Faster eval sweeps"; you opened it\] $/,
    );
  });

  it("names the Library artifact a thread started from its view is about, by a link", () => {
    // Questions asked while reading an artifact go to its own thread; the leader reads which one.
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "99feed00"
          ? {
              id: "99feed00-5555",
              name: "The Rocq proof eval, explained",
              thread: {
                startedFrom: "q-12",
                artifact: { id: "c0a3178d-6b34", title: "The Rocq proof eval, explained" },
              },
            }
          : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "why?", "topic:99feed00", "u4")).toMatch(
      /\[user thread: "The Rocq proof eval, explained"; about \[The Rocq proof eval, explained\]\(artifact:c0a3178d\); started from q-12\] $/,
    );
  });

  it("names the thread and where it started by address once threads are numbered", () => {
    // Leaders read and write threads by their short address (`t-17`), so the tag uses it too.
    rememberThreadNumbers([
      [17, "55badbba"],
      [4, "66cafe00"],
    ]);
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "55badbba"
          ? {
              id: "55badbba-1111",
              name: "Quick question: how do…",
              thread: { startedFrom: "topic:66cafe00" },
            }
          : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:55badbba", "u1")).toMatch(
      /\[thread:t-17\] \[user thread: "Quick question: how do…"; started from t-4\] $/,
    );
  });

  it("adds nothing for messages written in a quest tab or Main", () => {
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "q-3", "u8")).toMatch(
      /\[User .* id:u8\] \[thread:q-3\] $/,
    );
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "main", "u9")).toMatch(
      /\[User .* id:u9\] \[thread:main\] $/,
    );
  });
});

describe("a user message that ends a side quest", () => {
  // q-31 is a side quest filed from u1, asked in q-30's thread.
  questSources.record([
    {
      questId: "q-31",
      relationships: { startedFrom: { sessionId: "leader", messageId: "raw-u1", threadKey: "q-30", timestamp: 10 } },
    },
  ]);
  const userMessage = (id: string, uN: string, threadKey: string) =>
    ({
      type: "user_message",
      id,
      leaderUserMessageId: uN,
      content: "text",
      timestamp: 10,
      threadKey,
      questId: threadKey,
      leaderResponseCoverageVersion: 1,
    }) as const;
  const deps = { getLauncherSessionInfo: () => ({ isOrchestrator: true }) as never };
  const deliver = (history: ReturnType<typeof userMessage>[], entry: ReturnType<typeof userMessage>) =>
    buildUserMessageDeliveryPrefix(
      { id: "leader", messageHistory: history } as never,
      { timestamp: 20, historyEntry: entry } as never,
      { type: "user_message", content: "text" } as never,
      "text",
      deps,
    );

  it("tells the leader the side quest is an ordinary quest now, with the message that made it one", () => {
    const ask = userMessage("raw-u1", "u1", "q-30");
    const inTab = userMessage("raw-u2", "u2", "q-31");
    expect(deliver([ask, inTab], inTab)).toContain(
      "[q-31 was a side quest of q-30 until this message: it is an ordinary quest now, so answer here and post its results here]",
    );
    // Later messages in its tab, and messages in the asking thread, carry no such tag.
    const again = userMessage("raw-u3", "u3", "q-31");
    expect(deliver([ask, inTab, again], again)).not.toContain("side quest");
    const elsewhere = userMessage("raw-u4", "u4", "q-30");
    expect(deliver([ask, elsewhere], elsewhere)).not.toContain("side quest");
  });
});
