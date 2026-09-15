import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendHistoryWindowSync, sendThreadWindowSync } from "./browser-transport-controller.js";

const session = {
  id: "viewport-target-proof",
  messageHistory: Array.from(
    { length: 12 },
    (_, index): BrowserIncomingMessage => ({
      type: "user_message",
      id: `message-${index}`,
      content: `Request ${index}`,
      timestamp: 1_700_000_000_000 + index,
      threadKey: "main",
    }),
  ),
};

describe("bounded window target lookup evidence", () => {
  it.each(["history", "thread"] as const)("identifies successful, absent and untargeted %s deliveries", (kind) => {
    // Echo lookup identity even on a content-hash cache hit: unchanged contents
    // or refresh revisions cannot identify which saved target was resolved.
    const receive = (targetMessageId?: string, cachedWindowHash?: string) => {
      const send = vi.fn();
      if (kind === "thread") {
        sendThreadWindowSync(
          session,
          { send },
          {
            threadKey: "main",
            fromItem: -1,
            itemCount: 3,
            sectionItemCount: 3,
            visibleItemCount: 1,
            targetMessageId,
            cachedWindowHash,
          },
        );
      } else {
        sendHistoryWindowSync(
          session,
          { send },
          {
            fromTurn: -1,
            turnCount: 3,
            sectionTurnCount: 3,
            visibleSectionCount: 1,
            targetMessageId,
            cachedWindowHash,
          },
        );
      }
      return JSON.parse(send.mock.calls.at(-1)![0] as string) as Extract<
        BrowserIncomingMessage,
        { type: "thread_window_sync" | "history_window_sync" }
      >;
    };
    const found = receive("message-2");
    expect(found.window.target_message_id).toBe("message-2");
    const absent = receive("missing-message");
    expect(absent.window.target_message_id).toBe("missing-message");
    expect(absent.window.has_newer_items).toBe(false);
    const cached = receive("missing-message", absent.window.window_hash);
    expect(cached.cache_hit).toBe(true);
    expect(cached.window.target_message_id).toBe("missing-message");
    expect(receive().window.target_message_id).toBeUndefined();
  });
});
