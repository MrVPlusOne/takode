// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));

import { sendComposerDraft } from "./composer-message-send.js";

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
});
