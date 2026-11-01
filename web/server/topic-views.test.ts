import { afterEach, describe, expect, it } from "vitest";
import { closestThreads, describeClosestThreads, isUnknownThreadKey, setTopicViewSource } from "./topic-views.js";
import { rememberThreadNumbers, resetThreadNumbersForTest } from "../shared/topic-thread-key.js";

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

afterEach(() => {
  setTopicViewSource(null);
  resetThreadNumbersForTest();
});

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

  it("names an address no thread has, and suggests the threads with the closest addresses", () => {
    // Threads are written by their address (`t-17`); a mistyped one gets the same warning, with
    // the suggestions written as addresses too.
    source();
    rememberThreadNumbers([
      [12, "6fd2c4bb"],
      [17, "8df94bcb"],
      [21, "6fd2c400"],
    ]);
    expect(isUnknownThreadKey("t-18")).toBe(true);
    expect(isUnknownThreadKey("t-17")).toBe(false);
    expect(closestThreads("t-27", 2)).toEqual([
      { key: "t-17", name: "Daily briefing" },
      { key: "t-21", name: "Relay notes" },
    ]);
    // A mistyped handle is compared by handle, and the suggestions still read as addresses.
    expect(closestThreads("topic:6fd2c4bc", 1)).toEqual([{ key: "t-12", name: "Relay testing" }]);
  });
});
