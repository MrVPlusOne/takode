// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { RefObject } from "react";
import { vi } from "vitest";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, QuestmasterTask } from "../types.js";
import { AssistantMessageMenu } from "./MessageActionMenus.js";

function message(): ChatMessage {
  return {
    id: "assistant-42",
    role: "assistant",
    content: "## Result\n\nUseful routed result.",
    timestamp: 10,
    historyIndex: 7,
    metadata: {
      threadKey: "q-42",
      questId: "q-42",
      threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    },
  };
}

function quest(): QuestmasterTask {
  return {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Outcome actions",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    outcome: {
      currentRevisionId: "r1",
      revisions: [
        {
          revisionId: "r1",
          markdown: "Earlier result.",
          summaryMarkdown: "Earlier result.",
          summarySource: "derived",
          contentHash: "hash",
          createdAt: 1,
          actor: { kind: "human" },
          sources: [],
        },
      ],
    },
  };
}

describe("AssistantMessageMenu Quest Outcome actions", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      sessions: new Map([["leader", { isOrchestrator: true } as any]]),
      sdkSessions: [{ sessionId: "leader", sessionNum: 7, isOrchestrator: true, state: "connected" } as any],
    });
    vi.restoreAllMocks();
  });

  it("promotes an exact routed leader message with CAS and source identity", async () => {
    vi.spyOn(api, "getQuestOutcome").mockResolvedValue({ questId: "q-42", outcome: quest().outcome ?? null });
    const update = vi.spyOn(api, "updateQuestOutcome").mockResolvedValue({
      quest: quest(),
      outcome: quest().outcome!,
    });

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
    fireEvent.click(screen.getByRole("button", { name: "Use as Current Outcome" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]).toEqual([
      "q-42",
      expect.objectContaining({
        baseRevisionId: "r1",
        mode: "replace",
        source: { sessionId: "leader", messageId: "assistant-42", historyIndex: 7 },
      }),
    ]);
  });

  it("does not expose inferred Outcome mutation actions outside a named quest tab", () => {
    render(
      <AssistantMessageMenu
        message={message()}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        sessionId="leader"
        currentThreadKey="main"
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    expect(screen.queryByRole("button", { name: "Use as Current Outcome" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to Current Outcome" })).toBeNull();
  });
  it("offers an explicit named-quest picker for audited Main-only copies", async () => {
    useStore.setState({
      sessionBoards: new Map([["leader", [{ questId: "q-42", title: "Outcome actions", status: "WORKING" } as any]]]),
    });
    vi.spyOn(api, "getQuestOutcome").mockResolvedValue({ questId: "q-42", outcome: null });
    const update = vi.spyOn(api, "updateQuestOutcome").mockResolvedValue({
      quest: quest(),
      outcome: quest().outcome!,
    });
    render(
      <AssistantMessageMenu
        message={{ ...message(), metadata: { threadKey: "main" } }}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        sessionId="leader"
        currentThreadKey="main"
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    fireEvent.click(screen.getByRole("button", { name: "Use as quest Outcome" }));
    fireEvent.click(screen.getByRole("button", { name: "q-42 Outcome actions" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe("q-42");
  });
});
