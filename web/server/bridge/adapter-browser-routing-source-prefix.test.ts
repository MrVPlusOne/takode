import { afterEach, describe, expect, it } from "vitest";
import { setTopicViewSource } from "../topic-views.js";
import { buildAdapterUserMessageSourcePrefix } from "./adapter-browser-routing-source-prefix.js";

/**
 * A message the user writes in a topic conversation is stored in the topic's own thread and reaches
 * the leader tagged with that thread, plus the topic's name and its quests (newest first), so it can
 * answer in the topic's thread or hand the message off to one of the quests.
 */
afterEach(() => setTopicViewSource(null));

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

  it("asks the leader to name a thread that still has its placeholder name", () => {
    // Leaders often answered without renaming, leaving the user's first words as the thread's name
    // in the Threads menu; the tag reminds them, with the exact command, until they rename it.
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "55badbba"
          ? { id: "55badbba-1111", name: "Quick question: how do…", thread: { placeholderName: true } }
          : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
    });
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "topic:55badbba", "u1")).toMatch(
      /\[user thread: "Quick question: how do…"; unnamed: name it after its subject with `takode topic rename topic:55badbba "<name>"`\] $/,
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
