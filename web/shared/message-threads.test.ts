import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import {
  explicitNonMainRoute,
  hasExplicitNonMainRoute,
  messageHasThreadRef,
  messageQuestThreads,
  messageThreadKeys,
} from "./message-threads.js";

/**
 * Which threads a message belongs to: one rule for thread windows, live delivery and leader
 * projections, kept per message. The kept answer must follow the changes a stored message really
 * gets (an attach adds a thread ref in place), or windows and live delivery would disagree again.
 */
function user(content: string, route: Partial<Extract<BrowserIncomingMessage, { type: "user_message" }>> = {}) {
  return { type: "user_message", id: "u1", content, timestamp: 1, ...route } as Extract<
    BrowserIncomingMessage,
    { type: "user_message" }
  >;
}

describe("message threads", () => {
  it("places a message in Main unless it is routed away, and in every quest it is routed to", () => {
    expect(messageThreadKeys(user("hi"))).toBeNull();
    expect(messageThreadKeys(user("hi", { threadKey: "main" }))).toEqual(["main"]);
    expect(messageThreadKeys(user("hi", { threadKey: "q-7", questId: "q-7" }))).toEqual(["q-7"]);
    // A [thread:] prefix in the text routes it too.
    const prefixed = user("[thread:q-9]\nreport");
    expect(messageThreadKeys(prefixed)).toEqual(["q-9"]);
    expect(explicitNonMainRoute(prefixed)).toMatchObject({ threadKey: "q-9" });
  });

  it("keeps a backfilled message in Main while adding the quest it was attached to", () => {
    const message = user("hi", { threadRefs: [{ threadKey: "q-3", questId: "q-3", source: "backfill" }] });
    expect(hasExplicitNonMainRoute(message)).toBe(false);
    expect(messageThreadKeys(message)).toEqual(["main", "q-3"]);
    expect([...messageQuestThreads(message, false)]).toEqual([]);
  });

  it("notices an attach that adds a thread ref to the stored message in place", () => {
    const message = user("hi", { threadKey: "main" });
    expect(messageHasThreadRef(message, "q-5")).toBe(false);
    message.threadRefs = [{ threadKey: "q-4", questId: "q-4", source: "explicit" }];
    expect(messageHasThreadRef(message, "q-4")).toBe(true);
    message.threadRefs.push({ threadKey: "q-5", questId: "q-5", source: "explicit" });
    expect(messageHasThreadRef(message, "Q-5")).toBe(true);
    // Written in Main, it stays there as well (as thread windows place it).
    expect(messageThreadKeys(message)).toEqual(["main", "q-4", "q-5"]);
  });

  it("puts attachment markers in no thread", () => {
    const marker = { type: "thread_attachment_marker", threadKey: "q-2" } as unknown as BrowserIncomingMessage;
    expect(messageThreadKeys(marker)).toEqual([]);
    expect(messageHasThreadRef(marker, "q-2")).toBe(false);
  });
});
