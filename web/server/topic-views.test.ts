import { afterEach, describe, expect, it } from "vitest";
import { closestThreads, describeClosestThreads, isUnknownThreadKey, setTopicViewSource } from "./topic-views.js";

/**
 * A leader can mistype a thread's handle, or route output to a topic's (topics are tags, nobody
 * writes in them); Takode warns instead of refusing. It recognizes a key that names no thread and
 * suggests the threads with the closest handles.
 */
const THREADS = [
  { id: "6fd2c4bb-0000", name: "Relay testing", thread: {} },
  { id: "8df94bcb-0000", name: "Daily briefing", thread: {} },
  { id: "6fd2c400-0000", name: "Relay notes", thread: {} },
];
const TOPIC = { id: "aa11bb22-0000", name: "Relay" };

afterEach(() => setTopicViewSource(null));

function source() {
  setTopicViewSource({
    topicOf: (handle) => [...THREADS, TOPIC].find((topic) => topic.id.startsWith(handle)) ?? null,
    questsOf: () => [],
    handlesOf: () => [],
    topicOfQuest: () => null,
    listThreads: () => THREADS,
  });
}

describe("unknown thread keys", () => {
  it("names a key no thread has, a topic's included, and nothing else", () => {
    source();
    expect(isUnknownThreadKey("topic:6fd2c4bc")).toBe(true);
    expect(isUnknownThreadKey("topic:aa11bb22")).toBe(true);
    expect(isUnknownThreadKey("topic:6fd2c4bb")).toBe(false);
    expect(isUnknownThreadKey("q-12")).toBe(false);
    expect(isUnknownThreadKey("main")).toBe(false);
    // Without the topic store nothing can be judged, so nothing is called unknown.
    setTopicViewSource(null);
    expect(isUnknownThreadKey("topic:6fd2c4bc")).toBe(false);
  });

  it("suggests the threads whose handles are closest", () => {
    source();
    expect(closestThreads("topic:6fd2c4bc", 2)).toEqual([
      { key: "topic:6fd2c4bb", name: "Relay testing" },
      { key: "topic:6fd2c400", name: "Relay notes" },
    ]);
    expect(describeClosestThreads("topic:6fd2c4bc")).toBe(
      'Closest threads: `topic:6fd2c4bb` "Relay testing", `topic:6fd2c400` "Relay notes", `topic:8df94bcb` "Daily briefing".',
    );
  });
});
