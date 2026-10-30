// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));

import { sendComposerDraft } from "./composer-message-send.js";
import { useStore } from "../store.js";

/**
 * What the composer sends: in a topic conversation, a message to the topic's own thread, with no
 * quest ID (only quest threads have one); in a quest tab, the quest.
 */
describe("sendComposerDraft", () => {
  beforeEach(() => sendToSession.mockClear());

  it("sends a topic conversation's message to the topic's thread", () => {
    expect(sendComposerDraft("s1", { text: "hello", images: [] }, { threadKey: "topic:aaaaaaaa" }, false)).toBe("sent");
    const message = (sendToSession.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(message).toMatchObject({ type: "user_message", content: "hello", threadKey: "topic:aaaaaaaa" });
    expect(message).not.toHaveProperty("questId");
    expect(message).not.toHaveProperty("viewKey");
  });

  it("sends a quest tab's message to the quest", () => {
    sendComposerDraft("s1", { text: "hi", images: [] }, { threadKey: "q-7" }, false);
    expect((sendToSession.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({
      threadKey: "q-7",
      questId: "q-7",
    });
  });

  it("takes the reply quote of its own composer and remembers it for Edit", () => {
    // A side chat's composer and the main one each have their own reply quote and draft.
    const sideKey = "s1#side:topic:aaaa0001";
    useStore.setState({
      replyContexts: new Map([
        ["s1", { messageId: "m-main", previewText: "Main answer" }],
        [sideKey, { messageId: "m-side", previewText: "Side answer" }],
      ]),
      pendingUserUploads: new Map(),
    });
    sendComposerDraft(
      "s1",
      { text: "on it", images: [], annotations: [{ id: "a", selectedText: "x", comment: "y" }] },
      { threadKey: "topic:aaaa0001", draftKey: sideKey },
      false,
    );
    const message = (sendToSession.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(message.replyContext).toEqual({ messageId: "m-side", previewText: "Side answer" });
    expect(useStore.getState().replyContexts.get(sideKey)).toBeUndefined();
    expect(useStore.getState().replyContexts.get("s1")).toEqual({ messageId: "m-main", previewText: "Main answer" });
    expect(useStore.getState().pendingUserUploads.get("s1")?.[0]?.draftKey).toBe(sideKey);
  });
});
