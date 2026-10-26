import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import { buildThreadWindowSync } from "./thread-window.js";
import { isTopicViewKey, topicIdOfViewKey, topicViewKey } from "./topic-thread-key.js";

/**
 * A topic conversation stitches the threads of a topic's quests into one feed in time order. Its
 * view key names the topic, so it stays the same while quests join or leave; the server passes
 * the topic's quests in when it builds a window.
 */
function user(id: string, threadKey?: string, sentFromView?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
    ...(threadKey ? { threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] } : {}),
    ...(sentFromView ? { sentFromView } : {}),
  };
}

function windowIds(history: BrowserIncomingMessage[], threadKey: string, topicMembers?: string[]): unknown[] {
  return buildThreadWindowSync({
    messageHistory: history,
    threadKey,
    topicMembers,
    fromItem: -1,
    itemCount: 50,
    sectionItemCount: 50,
    visibleItemCount: 10,
  }).entries.map((entry) => (entry.message.type === "user_message" ? entry.message.id : entry.history_index));
}

describe("topic conversations", () => {
  it("is named by its topic, not its quests", () => {
    const key = topicViewKey(" T1 ");
    expect(key).toBe("topic:t1");
    expect(topicIdOfViewKey(key)).toBe("t1");
    expect(isTopicViewKey("q-3")).toBe(false);
    expect(isTopicViewKey("topic:")).toBe(false);
  });

  it("merges its quests' threads in time order and leaves out other threads", () => {
    const history = [user("u1", "q-3"), user("u2"), user("u3", "q-12"), user("u4", "q-99"), user("u5", "q-3")];
    expect(windowIds(history, topicViewKey("t1"), ["q-3", "q-12"])).toEqual(["u1", "u3", "u5"]);
    // The same view after a quest joins the topic: nothing about the key changes.
    expect(windowIds(history, topicViewKey("t1"), ["q-3", "q-12", "q-99"])).toEqual(["u1", "u3", "u4", "u5"]);
  });

  it("keeps a message sent from it there, wherever the leader files it", () => {
    // A message typed in the topic view belongs to that view from the moment it is sent, before
    // the leader files it in a thread (Main here) and after it files it in a quest elsewhere.
    const key = topicViewKey("t1");
    const history = [user("u1", "q-3"), user("u2", undefined, key), user("u3", "q-99", key), user("u4", "q-99")];
    expect(windowIds(history, key, ["q-3"])).toEqual(["u1", "u2", "u3"]);
    // It still shows in the thread it was filed in, and other views are unaffected.
    expect(windowIds(history, "q-99")).toEqual(["u3", "u4"]);
    expect(windowIds(history, topicViewKey("t2"), ["q-3"])).toEqual(["u1"]);
  });
});
