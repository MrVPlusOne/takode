import { afterEach, describe, expect, it } from "vitest";
import { setTopicViewSource } from "../topic-views.js";
import { buildAdapterUserMessageSourcePrefix } from "./adapter-browser-routing-source-prefix.js";

/**
 * A message the user sent from a topic conversation reaches the leader as a Main request that
 * knows its topic: the source tag adds the topic's name and its quests, newest first.
 */
afterEach(() => setTopicViewSource(null));

describe("user message source tag", () => {
  const leader = () => ({ id: "leader" }) as never;
  const info = () => ({ isOrchestrator: true }) as never;

  it("adds the topic a message was sent from, with its quests", () => {
    setTopicViewSource({
      questsOf: (id) => (id === "t1" ? ["q-3", "q-12", "q-9"] : []),
      topicOfQuest: () => null,
      nameOf: (id) => (id === "t1" ? "Daily briefing" : null),
    });
    const prefix = buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "main", "u7", "topic:t1");
    expect(prefix).toMatch(/\[User .* id:u7\] \[thread:main\] \[topic: "Daily briefing"; quests: q-12, q-9, q-3\] $/);
  });

  it("adds nothing for messages sent from a quest tab or Main", () => {
    const prefix = buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "q-3", "u8");
    expect(prefix).toMatch(/\[User .* id:u8\] \[thread:q-3\] $/);
  });
});
