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

  it("adds nothing for messages written in a quest tab or Main", () => {
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "q-3", "u8")).toMatch(
      /\[User .* id:u8\] \[thread:q-3\] $/,
    );
    expect(buildAdapterUserMessageSourcePrefix(leader(), 0, info, undefined, "hi", "main", "u9")).toMatch(
      /\[User .* id:u9\] \[thread:main\] $/,
    );
  });
});
