// @vitest-environment jsdom
/**
 * A conversation in the side column reads like the main view: a request there that moved into a
 * quest says where it continues, so its feed gets the leader's started quests as the main feed does.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartedQuestsContext } from "../QuestForkLinks.js";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import type { SessionNotification } from "../../types.js";
import { ChatFocusContext, MAIN_CHAT, useChatFocusStore } from "../../utils/chat-focus.js";

vi.mock("../MessageFeed.js", () => ({
  MessageFeed: ({ questChips }: { questChips?: ReactNode }) => {
    const started = useContext(StartedQuestsContext);
    return (
      <div data-testid="feed">
        {started
          ?.get("side-ask")
          ?.map((quest) => quest.questId)
          .join(",") ?? "none"}
        {questChips}
      </div>
    );
  },
}));
vi.mock("../Composer.js", () => ({ Composer: () => null }));
vi.mock("../../hooks/use-unread-messages-seen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/use-unread-messages-seen.js")>()),
  useUnreadMessagesSeen: () => {},
}));
vi.mock("../../utils/leader-topics.js", () => ({ useKnownThreadOfKey: () => null }));
vi.mock("../library/TopicConversation.js", () => ({ useStandaloneTopicConversation: () => null }));

import { SideConversation } from "./SideConversation.js";
import { getSideViews } from "../../utils/side-views.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useChatFocusStore.setState({ focused: MAIN_CHAT, sideChats: [] });
  useStore.setState({ sessionNotifications: new Map() });
});

describe("SideConversation", () => {
  it("gives its feed the quests the leader's requests continue in", async () => {
    const startedFrom = { sessionId: "leader", messageId: "side-ask", threadKey: "topic:aaaa0001", timestamp: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ quests: [{ questId: "q-9", title: "Slides", startedFrom, sideQuest: false }] }),
      ),
    );
    render(<SideConversation leaderId="leader" threadKey="topic:aaaa0001" />);
    expect(await screen.findByText("q-9")).toBeTruthy();
  });

  it("shows a quest thread's state as chips at its feed's top, as the main view does", async () => {
    // Jiayi: side chats render the feed the same as the main view. The quest's chips come from its
    // leader's board, like the main view's; a thread that is not a quest's has none.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ quests: [] })),
    );
    useStore.setState({
      sessionBoards: new Map([["leader", [{ questId: "q-7", title: "Slides", status: "QUEUED", updatedAt: 1 }]]]),
    } as never);
    const view = render(<SideConversation leaderId="leader" threadKey="q-7" />);
    expect(await screen.findByTestId(/^quest-thread-feed-chips/)).toBeTruthy();
    view.unmount();
    render(<SideConversation leaderId="leader" threadKey="topic:aaaa0001" />);
    expect(screen.queryByTestId(/^quest-thread-feed-chips/)).toBeNull();
    useStore.setState({ sessionBoards: new Map() } as never);
  });

  // Jiayi's report (Nov 1): a side pane showing a finished quest kept "1 new" however long it was
  // focused. Its answer read by seeing, but the Quest complete result, which the main view reads
  // when its thread is on screen, was never read in a pane.
  describe("a finished quest's result", () => {
    const questComplete: SessionNotification = {
      id: "n-done",
      category: "review",
      unreadReason: "quest-complete",
      summary: "q-7 ready for review: Slides",
      timestamp: 1,
      messageId: "msg-done",
      threadKey: "q-7",
      questId: "q-7",
      done: false,
    };
    const renderPane = (focused: string) => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ quests: [] })),
      );
      const markDone = vi.spyOn(api, "markNotificationDone").mockResolvedValue(undefined as never);
      useStore.setState({ sessionNotifications: new Map([["leader", [questComplete]]]) });
      useChatFocusStore.setState({ focused, sideChats: ["side:pane"] });
      render(
        <ChatFocusContext.Provider value="side:pane">
          <SideConversation leaderId="leader" threadKey="q-7" />
        </ChatFocusContext.Provider>,
      );
      return markDone;
    };

    it("reads once the focused pane has shown its thread for a moment", async () => {
      const markDone = renderPane("side:pane");
      await act(async () => vi.advanceTimersByTime(2_000));
      expect(markDone).toHaveBeenCalledWith("leader", "n-done", true);
    });

    it("stays unread while another chat is focused", async () => {
      // One focused chat: a pane beside the chat the user works in reads nothing by itself.
      const markDone = renderPane(MAIN_CHAT);
      await act(async () => vi.advanceTimersByTime(5_000));
      expect(markDone).not.toHaveBeenCalled();
    });
  });

  it("tells the server it shows its thread while mounted, wherever it is", () => {
    // Live messages of a thread reach a browser only for the views it shows. An artifact's side chat
    // (outside the side column) didn't say so, and its first message stayed "Sending..." while
    // the leader answered unseen. Each mounted conversation now registers itself.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ quests: [] }))),
    );
    const first = render(<SideConversation leaderId="l9" threadKey="topic:CAFE0001" />);
    const second = render(<SideConversation leaderId="l9" threadKey="q-4" />);
    expect(getSideViews("l9")).toEqual(["q-4", "topic:cafe0001"]);
    first.unmount();
    expect(getSideViews("l9")).toEqual(["q-4"]);
    second.unmount();
    expect(getSideViews("l9")).toEqual([]);
  });
});
