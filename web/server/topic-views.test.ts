import { afterEach, describe, expect, it } from "vitest";
import { closestTopics, describeClosestTopics, isUnknownTopicKey, setTopicViewSource } from "./topic-views.js";

/**
 * A leader can mistype a topic thread's handle; Takode warns instead of refusing. It recognizes a
 * key no topic has and suggests the topics with the closest handles.
 */
const TOPICS = [
  { id: "6fd2c4bb-0000", name: "Relay testing" },
  { id: "8df94bcb-0000", name: "Daily briefing" },
  { id: "6fd2c400-0000", name: "Relay notes" },
];

afterEach(() => setTopicViewSource(null));

function source() {
  setTopicViewSource({
    topicOf: (handle) => TOPICS.find((topic) => topic.id.startsWith(handle)) ?? null,
    questsOf: () => [],
    handlesOf: () => [],
    topicOfQuest: () => null,
    listTopics: () => TOPICS,
  });
}

describe("unknown topic keys", () => {
  it("names a topic key no topic has, and nothing else", () => {
    source();
    expect(isUnknownTopicKey("topic:6fd2c4bc")).toBe(true);
    expect(isUnknownTopicKey("topic:6fd2c4bb")).toBe(false);
    expect(isUnknownTopicKey("q-12")).toBe(false);
    expect(isUnknownTopicKey("main")).toBe(false);
    // Without the topic store nothing can be judged, so nothing is called unknown.
    setTopicViewSource(null);
    expect(isUnknownTopicKey("topic:6fd2c4bc")).toBe(false);
  });

  it("suggests the topics whose handles are closest", () => {
    source();
    expect(closestTopics("topic:6fd2c4bc", 2)).toEqual([
      { key: "topic:6fd2c4bb", name: "Relay testing" },
      { key: "topic:6fd2c400", name: "Relay notes" },
    ]);
    expect(describeClosestTopics("topic:6fd2c4bc")).toBe(
      'Closest topics: `topic:6fd2c4bb` "Relay testing", `topic:6fd2c400` "Relay notes", `topic:8df94bcb` "Daily briefing".',
    );
  });
});
