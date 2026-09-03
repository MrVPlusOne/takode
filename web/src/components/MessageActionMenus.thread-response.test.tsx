// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { RefObject } from "react";
import { vi } from "vitest";
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
      leaderUserMessage: true,
      threadKey,
      ...(threadKey === "main"
        ? {}
        : {
            questId: threadKey,
            threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }],
          }),
      threadResponse: {
        logicalResponseId: "response-42",
        revisionId: "summary-42-r1",
        revisionNumber: 1,
        batchId: "batch-42",
        batchObservedHistoryLength: 8,
        coveredUserMessageIds: ["user-42"],
        contentHash: "hash-r1",
      },
    },
  };
}

describe("AssistantMessageMenu leader response authority", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      sessions: new Map([["leader", { isOrchestrator: true } as any]]),
      sdkSessions: [{ sessionId: "leader", sessionNum: 7, isOrchestrator: true, state: "connected" } as any],
    });
  });

  it("does not expose human mutation actions for a leader-managed summary revision", () => {
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

    expect(screen.queryByRole("button", { name: /Outcome/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy message link" })).toBeVisible();
  });

  it("does not expose the rejected Main-thread quest picker even when board quests exist", () => {
    useStore.setState({
      sessionBoards: new Map([["leader", [{ questId: "q-42", title: "Leader summaries", status: "WORKING" } as any]]]),
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

    expect(screen.queryByRole("button", { name: /quest Outcome/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply to this message" })).toBeVisible();
  });

  it("keeps ordinary message actions available for non-summary assistant prose", () => {
    const ordinary = { ...message(), metadata: { threadKey: "q-42" } };
    render(
      <AssistantMessageMenu
        message={ordinary}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        sessionId="leader"
        currentThreadKey="q-42"
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));

    expect(screen.getByRole("button", { name: "Reply to this message" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy as Plain Text" })).toBeVisible();
  });
});
