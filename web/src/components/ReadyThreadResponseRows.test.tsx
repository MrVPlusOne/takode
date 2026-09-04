// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";
import { ReadyThreadResponseRows } from "./ReadyThreadResponseRows.js";

function entry(id: string, content: string, historyIndex?: number): Extract<FeedEntry, { kind: "message" }> {
  return {
    kind: "message",
    msg: { id, role: "assistant", content, timestamp: 1, ...(historyIndex === undefined ? {} : { historyIndex }) },
  };
}

function turn(entries: FeedEntry[]): Turn {
  return {
    id: "u2",
    userEntry: { kind: "message", msg: { id: "u2", role: "user", content: "Second request", timestamp: 1 } },
    allEntries: entries,
    presentationEntries: entries,
    agentEntries: entries,
    systemEntries: [],
    notificationEntries: [],
    responseEntry: null,
    subConclusions: [],
    collapsedEntries: [],
    stats: { messageCount: entries.length, toolCount: 0, subagentCount: 0, herdEventCount: 0 },
  };
}

function presentation(coveredUserMessageIds = ["u1", "u2"]): ThreadResponsePresentation {
  const current = entry("response-current", "Current polished response");
  return {
    ready: true,
    cutoverHistoryIndex: 0,
    pendingMessageCount: 0,
    currentResponses: [
      {
        response: {
          version: 2,
          threadKey: "q-2",
          questId: "q-2",
          answerUserMessageIds: coveredUserMessageIds,
          referencedUserMessageIds: coveredUserMessageIds,
          coveredAnswerUserMessageIds: coveredUserMessageIds,
          coveredUserMessageIds,
          currentMessageId: "response-current",
          currentHistoryIndex: 4,
          createdAt: 4,
          updatedAt: 4,
          source: "explicit",
        },
        anchorUserMessageId: coveredUserMessageIds.at(-1)!,
        anchorTurnId: "u2",
        anchorOrder: 1,
        sourceTurnId: "u2",
        messageEntry: current,
        collapsedMessageEntry: current,
        referencedUserMessages: coveredUserMessageIds.map((id, index) => ({
          historyMessageId: id,
          userMessageId: id,
          content: `Referenced request ${index + 1}`,
        })),
      },
    ],
    currentResponseMessageIds: new Set(["response-current"]),
    quizGroups: [],
    layoutSignature: "response:r1",
  };
}

describe("ReadyThreadResponseRows", () => {
  it("renders a grouped response as normal prose with a concise coverage count and no editor controls", () => {
    const current = presentation();
    render(
      <ReadyThreadResponseRows
        turn={turn([current.currentResponses[0]!.messageEntry])}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.getByText("Current polished response")).toBeVisible();
    const coverage = screen.getByTestId("thread-response-answer-count");
    expect(coverage).toHaveTextContent("Answers 2 messages");
    fireEvent.click(coverage);
    expect(screen.getByTestId("thread-response-coverage-preview")).toHaveTextContent("Referenced request 1");
    expect(screen.getByTestId("thread-response-coverage-preview")).toHaveTextContent("Referenced request 2");
    expect(screen.queryByText("Current answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit|Save new version|Versions/i })).not.toBeInTheDocument();
  });

  it("renders singular coverage for a one-message answer", () => {
    const current = presentation(["u2"]);
    render(
      <ReadyThreadResponseRows
        turn={turn([current.currentResponses[0]!.messageEntry])}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.getByText("Current polished response")).toBeVisible();
    expect(screen.getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 1 message");
  });

  it("leaves intermediate activity hidden for the parent turn footer to reveal", () => {
    const current = presentation();
    const intermediate = entry("intermediate", "Hidden intermediate prose");
    render(
      <ReadyThreadResponseRows
        turn={turn([intermediate, current.currentResponses[0]!.messageEntry])}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.queryByText("Hidden intermediate prose")).not.toBeInTheDocument();
    expect(screen.getByText("Current polished response")).toBeVisible();
    expect(screen.getByRole("button", { name: "Answers 2 messages; preview referenced messages" })).toBeVisible();
  });

  it("leaves collapsed system activity hidden without creating a competing control", () => {
    const current = presentation();
    const system = entry("system", "Hidden system detail");
    const targetTurn = turn([current.currentResponses[0]!.messageEntry]);
    targetTurn.systemEntries = [system];
    render(
      <ReadyThreadResponseRows
        turn={targetTurn}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.queryByText("Hidden system detail")).not.toBeInTheDocument();
    expect(screen.getByText("Current polished response")).toBeVisible();
    expect(screen.getByRole("button", { name: "Answers 2 messages; preview referenced messages" })).toBeVisible();
  });

  it("keeps co-anchored answer rows in history order when the earlier row came from another turn", () => {
    // The later answer is physically present in this turn, while the earlier
    // overlapping answer was relocated here. Source-local ordering must not
    // put the later answer first.
    const current = presentation();
    const base = current.currentResponses[0]!;
    const earlier = entry("response-earlier", "Earlier detailed answer", 3);
    base.messageEntry.msg.historyIndex = 5;
    base.collapsedMessageEntry.msg.historyIndex = 5;
    current.currentResponses = [
      {
        ...base,
        response: {
          ...base.response,
          coveredAnswerUserMessageIds: [],
          coveredUserMessageIds: [],
          currentMessageId: earlier.msg.id,
          currentHistoryIndex: 3,
        },
        sourceTurnId: "u1",
        messageEntry: earlier,
        collapsedMessageEntry: earlier,
      },
      base,
    ];
    current.currentResponseMessageIds = new Set([earlier.msg.id, base.messageEntry.msg.id]);

    const { container } = render(
      <ReadyThreadResponseRows
        turn={turn([base.messageEntry])}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(container.textContent?.indexOf("Earlier detailed answer")).toBeLessThan(
      container.textContent?.indexOf("Current polished response") ?? -1,
    );
  });
  it("keeps exact unresolved needs-input anchors beside current responses in source order without duplication", () => {
    const current = presentation(["u2"]);
    current.currentResponses[0]!.messageEntry.msg.historyIndex = 4;
    current.currentResponses[0]!.collapsedMessageEntry.msg.historyIndex = 4;
    const firstPrompt = entry("prompt-first", "First unresolved decision", 5);
    const secondPrompt = entry("prompt-second", "Second unresolved decision", 6);
    const targetTurn = turn([current.currentResponses[0]!.messageEntry, firstPrompt, firstPrompt, secondPrompt]);

    const { container } = render(
      <ReadyThreadResponseRows
        turn={targetTurn}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        activeNeedsInputAnchorMessageIds={new Set(["prompt-first", "prompt-second"])}
        renderEntry={(item) =>
          item.kind === "message" ? <div data-message-id={item.msg.id}>{item.msg.content}</div> : <div>activity</div>
        }
      />,
    );

    expect(container.textContent?.indexOf("Current polished response")).toBeLessThan(
      container.textContent?.indexOf("First unresolved decision") ?? -1,
    );
    expect(container.textContent?.indexOf("First unresolved decision")).toBeLessThan(
      container.textContent?.indexOf("Second unresolved decision") ?? -1,
    );
    expect(container.querySelectorAll('[data-message-id="prompt-first"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-message-id="prompt-second"]')).toHaveLength(1);
    expect(screen.getAllByTestId("thread-response-needs-input-prompt")).toHaveLength(2);
    expect(screen.getAllByTestId("thread-response-answer-count")).toHaveLength(1);
  });

  it("does not duplicate an unresolved anchor that is already the current response", () => {
    const current = presentation(["u2"]);
    const currentEntry = current.currentResponses[0]!.messageEntry;
    const { container } = render(
      <ReadyThreadResponseRows
        turn={turn([currentEntry])}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        activeNeedsInputAnchorMessageIds={new Set(["response-current"])}
        renderEntry={(item) =>
          item.kind === "message" ? <div data-message-id={item.msg.id}>{item.msg.content}</div> : <div>activity</div>
        }
      />,
    );

    expect(container.querySelectorAll('[data-message-id="response-current"]')).toHaveLength(1);
    expect(screen.queryByTestId("thread-response-needs-input-prompt")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("thread-response-answer-count")).toHaveLength(1);
  });

  it("releases special prompt pinning when the authoritative active-anchor set clears", () => {
    const current = presentation(["u2"]);
    const prompt = entry("prompt", "Decision no longer unresolved", 5);
    const targetTurn = turn([current.currentResponses[0]!.messageEntry, prompt]);
    const renderEntry = (item: FeedEntry) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>;
    const view = render(
      <ReadyThreadResponseRows
        turn={targetTurn}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        activeNeedsInputAnchorMessageIds={new Set(["prompt"])}
        renderEntry={renderEntry}
      />,
    );

    expect(screen.getByText("Decision no longer unresolved")).toBeVisible();
    view.rerender(
      <ReadyThreadResponseRows
        turn={targetTurn}
        presentation={current}
        sessionId="leader"
        questLinkSurface="chat-feed"
        activeNeedsInputAnchorMessageIds={new Set()}
        renderEntry={renderEntry}
      />,
    );

    expect(screen.queryByText("Decision no longer unresolved")).not.toBeInTheDocument();
    expect(screen.getByText("Current polished response")).toBeVisible();
  });
});
