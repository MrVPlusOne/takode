import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import { buildThreadWindowSync } from "./thread-window.js";
import { isTopicViewKey, normalizeTopicKey, topicIdOfViewKey, topicViewKey } from "./topic-thread-key.js";

/**
 * A topic conversation stitches the topic's own thread (what was written in the conversation) and
 * the threads of its quests into one feed in time order. Its key names the topic by a short handle,
 * so it stays the same while quests join or leave; the server passes the topic's quests in when it
 * builds a window.
 */
const TOPIC = "8df94bcb-8daf-4026-8f72-20f861f7ae83";
const KEY = topicViewKey(TOPIC);

function user(id: string, threadKey?: string, extra: Record<string, unknown> = {}): BrowserIncomingMessage {
  const quest = threadKey?.startsWith("q-") ? threadKey : undefined;
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    ...(threadKey ? { threadKey } : {}),
    ...(quest ? { questId: quest } : {}),
    ...(threadKey && threadKey !== "main"
      ? { threadRefs: [{ threadKey, ...(quest ? { questId: quest } : {}), source: "explicit" as const }] }
      : {}),
    ...extra,
  } as BrowserIncomingMessage;
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
  it("is named by a short handle of its topic, not its quests", () => {
    expect(KEY).toBe("topic:8df94bcb");
    expect(topicIdOfViewKey(KEY)).toBe("8df94bcb");
    // Keys that named the whole topic ID (before handles) name the same topic.
    expect(normalizeTopicKey(`topic:${TOPIC}`)).toBe(KEY);
    expect(isTopicViewKey("q-3")).toBe(false);
    expect(isTopicViewKey("topic:")).toBe(false);
  });

  it("merges its own thread and its quests' threads in time order and leaves out other threads", () => {
    const history = [user("u1", "q-3"), user("u2"), user("u3", "q-12"), user("u4", "q-99"), user("u5", KEY)];
    expect(windowIds(history, KEY, ["q-3", "q-12"])).toEqual(["u1", "u3", "u5"]);
    // The same view after a quest joins the topic: nothing about the key changes.
    expect(windowIds(history, KEY, ["q-3", "q-12", "q-99"])).toEqual(["u1", "u3", "u4", "u5"]);
    // A message written in the topic is not a Main message.
    expect(windowIds(history, "main")).toEqual(["u2"]);
  });

  it("shows the leader's answer in the topic's thread", () => {
    // Jiayi's message from the Daily briefing topic showed there, but the answer to it didn't: it was
    // a Main answer, which a topic view leaves out. Now both are in the topic's own thread.
    const answer = {
      type: "assistant",
      message: { id: "a1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null },
      timestamp: 3,
      threadKey: KEY,
      threadRefs: [{ threadKey: KEY, source: "explicit" }],
    } as unknown as BrowserIncomingMessage;
    const history = [user("u1", "q-3"), user("u2", KEY), answer];
    expect(windowIds(history, KEY, ["q-3"])).toEqual(["u1", "u2", 2]);
    expect(windowIds(history, "main")).toEqual([]);
  });

  it("keeps showing messages sent from it before topics had threads", () => {
    // Those were Main messages noting the topic view they came from (`sentFromView`, and answers
    // stamped with it); they count as attached to the topic's thread, so Main keeps them too.
    const legacy = user("u2", "main", { sentFromView: `topic:${TOPIC}` });
    const history = [user("u1", "q-3"), legacy, user("u3", "q-99")];
    expect(windowIds(history, KEY, ["q-3"])).toEqual(["u1", "u2"]);
    expect(windowIds(history, "main")).toEqual(["u2"]);
  });
});
