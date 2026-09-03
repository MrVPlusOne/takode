// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { RefObject } from "react";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { AssistantMessageMenu } from "./MessageActionMenus.js";

function message(threadKey = "q-42"): ChatMessage {
  return {
    id: "assistant-42",
    role: "assistant",
    content: "## Result\n\nUseful routed result.",
    timestamp: 10,
    historyIndex: 7,
    metadata: {
      threadKey,
      ...(threadKey === "main"
        ? {}
        : {
            questId: threadKey,
            threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }],
          }),
    },
  };
}

describe("AssistantMessageMenu", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      sessions: new Map([["leader", { isOrchestrator: true } as any]]),
      sdkSessions: [{ sessionId: "leader", sessionNum: 7, isOrchestrator: true, state: "connected" } as any],
    });
  });

  it("keeps copy actions available for routed assistant messages", () => {
    render(
      <AssistantMessageMenu
        message={message()}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        sessionId="leader"
        currentThreadKey="q-42"
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));

    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy as Plain Text" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy message link" })).toBeVisible();
  });

  it("keeps reply actions available in Main even when the leader board has quests", () => {
    useStore.setState({
      sessionBoards: new Map([["leader", [{ questId: "q-42", title: "Leader work", status: "WORKING" } as any]]]),
    });

    render(
      <AssistantMessageMenu
        message={message("main")}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        sessionId="leader"
        currentThreadKey="main"
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));

    expect(screen.getByRole("button", { name: "Reply to this message" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy message link" })).toBeVisible();
  });
});
