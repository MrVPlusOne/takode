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
vi.mock("./SideChatLeaders.js", () => ({
  LeaderName: ({ sessionId }: { sessionId: string }) => <>{`leader ${sessionId}`}</>,
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
    render(<NewSideChat columnId="l1" leaderId="l1" itemId={itemId} startedFrom="q-7" />);
    expect(screen.getByTestId("new-side-chat").textContent).toContain("About name of q-7");
    expect(composer.props!.draftKey).toBe(newSideChatDraftKey("l1"));
    expect(composer.props!.threadKey).toBe("q-7");

    await expect(composer.props!.newThread.start("Why does it settle?")).resolves.toBe("topic:aaaa0001");
    expect(startThread).toHaveBeenCalledWith("l1", "named: Why does it settle?", "q-7", "Why does it settle?");
    composer.props!.newThread.started("topic:aaaa0001");
    expect(useSideColumnStore.getState().columns.l1).toEqual({
      items: [{ id: itemId, kind: "conversation", threadKey: "topic:aaaa0001" }],
      open: itemId,
    });
  });

  it("starts a chat with another leader as that leader's, kept in this column", async () => {
    // Jiayi (Oct 31): from Daily Leader's page, a side chat with the Takode leader. The thread is
    // the Takode leader's (it answers it and lists it); this column keeps showing it.
    startThread.mockResolvedValue({
      thread: { id: "bbbb0001", key: "topic:bbbb0001", name: "named", leaderId: "l2", createdAt: 1, activityAt: 1 },
    });
    const itemId = openInSide("l1", { kind: "new-chat", startedFrom: "q-7", leaderId: "l2" });
    render(<NewSideChat columnId="l1" leaderId="l2" itemId={itemId} startedFrom="q-7" />);
    expect(screen.getByTestId("new-side-chat-with").textContent).toBe("A side chat with leader l2");
    expect(composer.props!.draftKey).toBe(newSideChatDraftKey("l2"));
    expect(composer.props!.threadKey).toBe("main");

    await composer.props!.newThread.start("Tweak the breadcrumb");
    // A quest is a place any leader can look up, so l2 is told the chat started there.
    expect(startThread).toHaveBeenCalledWith("l2", "named: Tweak the breadcrumb", "q-7", "Tweak the breadcrumb");
    composer.props!.newThread.started("topic:bbbb0001");
    expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
      { id: itemId, kind: "conversation", threadKey: "topic:bbbb0001", leaderId: "l2" },
    ]);
  });

  it("doesn't tell another leader about a place only this leader knows", async () => {
    startThread.mockResolvedValue({
      thread: { id: "bbbb0002", key: "topic:bbbb0002", name: "named", leaderId: "l2", createdAt: 1, activityAt: 1 },
    });
    const itemId = openInSide("l1", { kind: "new-chat", startedFrom: "topic:aaaa0009", leaderId: "l2" });
    render(<NewSideChat columnId="l1" leaderId="l2" itemId={itemId} startedFrom="topic:aaaa0009" />);
    expect(screen.getByTestId("new-side-chat").textContent).toContain("The conversation on the left stays as it is.");
    await composer.props!.newThread.start("Hello");
    expect(startThread).toHaveBeenCalledWith("l2", "named: Hello", undefined, "Hello");
  });
});
