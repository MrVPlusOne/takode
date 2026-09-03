// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";
import { ReadyThreadResponseRows } from "./ReadyThreadResponseRows.js";

function entry(id: string, content: string): Extract<FeedEntry, { kind: "message" }> {
  return { kind: "message", msg: { id, role: "assistant", content, timestamp: 1 } };
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
          version: 1,
          logicalResponseId: "logical-response",
          threadKey: "q-2",
          questId: "q-2",
          batchId: "batch-1",
          batchObservedHistoryLength: 5,
          coveredUserMessageIds,
          currentRevisionId: "r1",
          currentMessageId: "response-current",
          currentHistoryIndex: 4,
          revisionCount: 1,
          createdAt: 4,
          updatedAt: 4,
        },
        anchorUserMessageId: coveredUserMessageIds.at(-1)!,
        anchorTurnId: "u2",
        anchorOrder: 1,
        sourceTurnId: "u2",
        messageEntry: current,
        collapsedMessageEntry: current,
      },
    ],
    currentResponseMessageIds: new Set(["response-current"]),
    quizQuestIds: [],
    quizHostTurnId: "u2",
    layoutSignature: "response:r1",
  };
}

describe("ReadyThreadResponseRows", () => {
  it("renders a grouped response as normal prose with concise provenance and no editor controls", () => {
    const current = presentation();
    render(
      <ReadyThreadResponseRows
        turn={turn([current.currentResponses[0]!.messageEntry])}
        presentation={current}
        durationMs={null}
        onExpand={() => {}}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.getByText("Current polished response")).toBeVisible();
    expect(screen.getByTestId("thread-response-group-provenance")).toHaveTextContent("Answers 2 messages");
    expect(screen.queryByRole("button", { name: /Edit|Save new version|Versions/i })).not.toBeInTheDocument();
  });

  it("omits grouped provenance for the normal singleton batch", () => {
    const current = presentation(["u2"]);
    render(
      <ReadyThreadResponseRows
        turn={turn([current.currentResponses[0]!.messageEntry])}
        presentation={current}
        durationMs={null}
        onExpand={() => {}}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.getByText("Current polished response")).toBeVisible();
    expect(screen.queryByTestId("thread-response-group-provenance")).not.toBeInTheDocument();
  });

  it("keeps intermediate activity behind an explicit expansion control", () => {
    const onExpand = vi.fn();
    const current = presentation();
    const intermediate = entry("intermediate", "Hidden intermediate prose");
    render(
      <ReadyThreadResponseRows
        turn={turn([intermediate, current.currentResponses[0]!.messageEntry])}
        presentation={current}
        durationMs={2_000}
        onExpand={onExpand}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.queryByText("Hidden intermediate prose")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Leader activity/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("keeps collapsed system activity behind the same explicit expansion control", () => {
    const onExpand = vi.fn();
    const current = presentation();
    const system = entry("system", "Hidden system detail");
    const targetTurn = turn([current.currentResponses[0]!.messageEntry]);
    targetTurn.systemEntries = [system];
    render(
      <ReadyThreadResponseRows
        turn={targetTurn}
        presentation={current}
        durationMs={null}
        onExpand={onExpand}
        sessionId="leader"
        questLinkSurface="chat-feed"
        renderEntry={(item) => <div>{item.kind === "message" ? item.msg.content : "activity"}</div>}
      />,
    );

    expect(screen.queryByText("Hidden system detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Leader activity/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
