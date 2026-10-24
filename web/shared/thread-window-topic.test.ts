import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import { buildProjectedThreadEntries } from "./thread-window.js";
import { topicThreadKey, topicThreadMembers } from "./topic-thread-key.js";

/**
 * A topic conversation stitches the threads of a topic's quests into one feed in time order. Its
 * key names the quests, so the server and the browser need no topic lookup.
 */
function user(id: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    ...(threadKey ? { threadKey, questId: threadKey } : {}),
    ...(threadKey ? { threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }] } : {}),
  };
}

describe("topic conversations", () => {
  it("names its quests in its key, oldest quest first", () => {
    const key = topicThreadKey(["q-12", "Q-3", "q-12"]);
    expect(key).toBe("topic:q-3+q-12");
    expect(topicThreadMembers(key)).toEqual(["q-3", "q-12"]);
    expect(topicThreadMembers("q-3")).toBeNull();
    expect(topicThreadMembers("topic:")).toBeNull();
  });

  it("merges its quests' threads in time order and leaves out other threads", () => {
    const history = [user("u1", "q-3"), user("u2"), user("u3", "q-12"), user("u4", "q-99"), user("u5", "q-3")];
    const ids = buildProjectedThreadEntries(history, topicThreadKey(["q-3", "q-12"])).map((entry) =>
      entry.message.type === "user_message" ? entry.message.id : entry.history_index,
    );
    expect(ids).toEqual(["u1", "u3", "u5"]);
  });
});
