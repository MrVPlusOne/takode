import { afterEach, describe, expect, it } from "vitest";
import {
  closestThreads,
  describeClosestThreads,
  isUnknownThreadKey,
  questConversationThreads,
  setTopicViewSource,
  threadConversationKey,
  viewKeysOfRoutes,
} from "./topic-views.js";
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

describe("threads that became part of another conversation", () => {
  // t-17 was handed off to q-40 and t-300 was later joined onto t-17: both read in the quest.
  const HANDED_OFF = { id: "5d1e7a20-0000", name: "Fresher Slack updates", thread: { quest: "q-40" } };
  const JOINED = { id: "5b6c7d8e-0000", name: "Slack follow-up", thread: { joinedInto: "topic:5d1e7a20" } };

  function joinedSource() {
    setTopicViewSource({
      topicOf: (handle) => [HANDED_OFF, JOINED].find((topic) => topic.id.startsWith(handle)) ?? null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
      threadsOfQuest: (questId) => (questId === "q-40" ? ["5d1e7a20"] : []),
      threadsJoinedInto: (threadId) => (threadId === "5d1e7a20" ? ["5b6c7d8e"] : []),
    });
  }

  it("names the threads a quest's window reads besides its own", () => {
    joinedSource();
    expect(questConversationThreads("q-40")).toEqual(["topic:5d1e7a20", "topic:5b6c7d8e"]);
    expect(questConversationThreads("q-12")).toEqual([]);
    expect(questConversationThreads("topic:5d1e7a20")).toEqual([]);
  });

  it("puts a message still routed to such a thread in every conversation it became part of", () => {
    joinedSource();
    expect(threadConversationKey("topic:5b6c7d8e")).toBe("q-40");
    expect(viewKeysOfRoutes(["topic:5b6c7d8e"])).toEqual(["topic:5b6c7d8e", "topic:5d1e7a20", "q-40"]);
    expect(threadConversationKey("q-12")).toBe("q-12");
  });
});
