// @vitest-environment jsdom
/**
 * A side chat not started yet: its first message starts a thread about the place it was opened on,
 * named after the message, and the side column item becomes that thread's conversation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const startThread = vi.hoisted(() => vi.fn());
vi.mock("../../api/topics.js", () => ({ topicApi: { startThread } }));
type NewThread = { start: (text: string) => Promise<string | null>; started: (threadKey: string) => void };
const composer = vi.hoisted(() => ({
  props: null as null | { newThread: NewThread; draftKey: string; threadKey: string },
}));
vi.mock("../Composer.js", () => ({
  Composer: (props: { newThread: NewThread; draftKey: string; threadKey: string }) => {
    composer.props = props;
    return null;
  },
}));
vi.mock("./thread-names.js", () => ({
  ThreadOriginName: ({ threadKey }: { threadKey: string }) => <>{`name of ${threadKey}`}</>,
  threadNameFromMessage: (text: string) => `named: ${text}`,
}));
import { openInSide, useSideColumnStore } from "../../utils/side-column.js";
import { NewSideChat, newSideChatDraftKey } from "./NewSideChat.js";

afterEach(() => {
  cleanup();
  startThread.mockReset();
  useSideColumnStore.setState({ columns: {} });
  localStorage.clear();
});

describe("NewSideChat", () => {
  it("starts a thread from the place it was opened on and becomes that thread", async () => {
    startThread.mockResolvedValue({
      thread: { id: "aaaa0001", key: "topic:aaaa0001", name: "named", leaderId: "l1", createdAt: 1, activityAt: 1 },
    });
    const itemId = openInSide("l1", { kind: "new-chat", startedFrom: "q-7" });
    render(<NewSideChat leaderId="l1" itemId={itemId} startedFrom="q-7" />);
    expect(screen.getByTestId("new-side-chat").textContent).toContain("About name of q-7");
    expect(composer.props!.draftKey).toBe(newSideChatDraftKey("l1", itemId));
    expect(composer.props!.threadKey).toBe("q-7");

    await expect(composer.props!.newThread.start("Why does it settle?")).resolves.toBe("topic:aaaa0001");
    expect(startThread).toHaveBeenCalledWith("l1", "named: Why does it settle?", "q-7", "Why does it settle?");
    composer.props!.newThread.started("topic:aaaa0001");
    expect(useSideColumnStore.getState().columns.l1).toEqual({
      items: [{ id: itemId, kind: "conversation", threadKey: "topic:aaaa0001" }],
      open: itemId,
    });
  });
});
