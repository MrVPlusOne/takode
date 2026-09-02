// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi } from "vitest";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, QuestmasterTask } from "../types.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { FeedSection } from "./message-feed-sections.js";
import { TurnEntries } from "./MessageFeedEntries.js";
import { useQuestOutcomeFeedPresentation } from "./QuestOutcomeFeed.js";

vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("remark-gfm", () => ({ default: {} }));

function message(id: string, content: string, historyIndex: number): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: historyIndex,
    historyIndex,
    metadata: {
      threadKey: "q-42",
      questId: "q-42",
      threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    },
  };
}

function turn(msg: ChatMessage): Turn {
  const entry: FeedEntry = { kind: "message", msg };
  return {
    id: `turn-${msg.id}`,
    userEntry: null,
    allEntries: [entry],
    presentationEntries: [entry],
    agentEntries: [entry],
    systemEntries: [],
    notificationEntries: [],
    responseEntry: entry,
    subConclusions: [],
    collapsedEntries: [{ kind: "entry", key: msg.id, entry }],
    stats: { messageCount: 1, toolCount: 0, subagentCount: 0, herdEventCount: 0 },
  };
}

function quest(status: "in_progress" | "done", anchorIndex: number): QuestmasterTask {
  const base = {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Outcome feed",
    description: "Test",
    createdAt: 1,
    outcome: {
      currentRevisionId: "r1",
      ...(status === "done" ? { finalizedRevisionId: "r1", finalizedAt: 30 } : {}),
      revisions: [
        {
          revisionId: "r1",
          markdown: "## Useful Outcome\n\nThe durable result.",
          summaryMarkdown: "The durable result.",
          summarySource: "derived" as const,
          contentHash: "hash",
          createdAt: 20,
          actor: { kind: "human" as const },
          anchor: { sessionId: "leader", historyIndex: anchorIndex, messageId: `a${anchorIndex}` },
          sources: [],
        },
      ],
    },
    quizItems: [{ id: "quiz", question: "What is primary?", answer: "The Outcome." }],
  };
  return status === "done"
    ? ({ ...base, status, completedAt: 30, verificationItems: [] } as QuestmasterTask)
    : ({ ...base, status, sessionId: "worker", claimedAt: 2 } as QuestmasterTask);
}

function Harness({
  status,
  messages,
  anchorIndex,
  scrollTargets = [],
}: {
  status: "in_progress" | "done";
  messages: ChatMessage[];
  anchorIndex: number;
  scrollTargets?: string[];
}) {
  const sections: FeedSection[] = [{ id: "section", turns: messages.map(turn) }];
  const outcome = useQuestOutcomeFeedPresentation({
    questId: "q-42",
    sessionId: "leader",
    sections,
    messages,
    hasNewerItems: false,
    scrollTargetMessageIds: scrollTargets,
  });
  return (
    <TurnEntries
      sections={sections}
      sessionId="leader"
      currentThreadKey="q-42"
      leaderMode
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={() => {}}
      turnStates={messages.map(() => ({ isActivityExpanded: true }))}
      toggleTurn={() => {}}
      questLinkSurface="chat-feed"
      outcomePresentation={outcome.presentation}
    />
  );
}

function UserAnchorHarness() {
  const user: ChatMessage = {
    id: "u3",
    role: "user",
    content: "Clarification request",
    timestamp: 3,
    historyIndex: 3,
  };
  const later = message("a4", "Later assistant activity", 4);
  const laterEntry: FeedEntry = { kind: "message", msg: later };
  const anchoredTurn: Turn = {
    ...turn(later),
    id: "user-anchor-turn",
    userEntry: { kind: "message", msg: user },
    allEntries: [laterEntry],
    presentationEntries: [laterEntry],
    agentEntries: [laterEntry],
    responseEntry: laterEntry,
  };
  const sections: FeedSection[] = [{ id: "section", turns: [anchoredTurn] }];
  const outcome = useQuestOutcomeFeedPresentation({
    questId: "q-42",
    sessionId: "leader",
    sections,
    messages: [user, later],
    hasNewerItems: false,
    scrollTargetMessageIds: [],
  });
  return (
    <TurnEntries
      sections={sections}
      sessionId="leader"
      currentThreadKey="q-42"
      leaderMode
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={() => {}}
      turnStates={[{ isActivityExpanded: true }]}
      toggleTurn={() => {}}
      questLinkSurface="chat-feed"
      outcomePresentation={outcome.presentation}
    />
  );
}

function SameTurnHarness() {
  const first = message("a3", "Promoted activity", 3);
  const later = message("a4", "Later same-turn activity", 4);
  const firstEntry: FeedEntry = { kind: "message", msg: first };
  const laterEntry: FeedEntry = { kind: "message", msg: later };
  const combinedTurn: Turn = {
    ...turn(first),
    id: "combined-turn",
    allEntries: [firstEntry, laterEntry],
    presentationEntries: [firstEntry, laterEntry],
    agentEntries: [firstEntry, laterEntry],
    responseEntry: laterEntry,
    stats: { messageCount: 2, toolCount: 0, subagentCount: 0, herdEventCount: 0 },
  };
  const sections: FeedSection[] = [{ id: "section", turns: [combinedTurn] }];
  const outcome = useQuestOutcomeFeedPresentation({
    questId: "q-42",
    sessionId: "leader",
    sections,
    messages: [first, later],
    hasNewerItems: false,
    scrollTargetMessageIds: [],
  });
  return (
    <TurnEntries
      sections={sections}
      sessionId="leader"
      currentThreadKey="q-42"
      leaderMode
      isCodexSession={false}
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={() => {}}
      turnStates={[{ isActivityExpanded: false }]}
      toggleTurn={() => {}}
      questLinkSurface="chat-feed"
      outcomePresentation={outcome.presentation}
    />
  );
}

describe("QuestOutcomeFeed", () => {
  beforeEach(() => {
    useStore.getState().reset();
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"same"' });
    useStore.setState({
      sessions: new Map([["leader", { isOrchestrator: true, backend_type: "claude" } as any]]),
      sdkSessions: [{ sessionId: "leader", sessionNum: 7, isOrchestrator: true, state: "connected" } as any],
    });
  });

  it("moves one active card between covered and newer chronological activity", () => {
    const messages = [message("a3", "Earlier activity", 3), message("a7", "Later activity", 7)];
    useStore.setState({ questDetails: new Map([["q-42", quest("in_progress", 3)]]) });
    const { container } = render(<Harness status="in_progress" messages={messages} anchorIndex={3} />);

    const text = container.textContent ?? "";
    expect(text.indexOf("Earlier activity")).toBeLessThan(text.indexOf("Useful Outcome"));
    expect(text.indexOf("Useful Outcome")).toBeLessThan(text.indexOf("Later activity"));
    expect(screen.getAllByTestId("quest-outcome-card")).toHaveLength(1);
    expect(screen.getByText("Newer activity follows")).toBeVisible();
  });

  it("inserts a user-anchored Outcome after the request and before its later response", () => {
    const active = quest("in_progress", 3);
    active.outcome!.revisions[0]!.anchor = { sessionId: "leader", historyIndex: 3, messageId: "u3" };
    useStore.setState({ questDetails: new Map([["q-42", active]]) });
    const { container } = render(<UserAnchorHarness />);

    const text = container.textContent ?? "";
    expect(text.indexOf("Clarification request")).toBeLessThan(text.indexOf("Useful Outcome"));
    expect(text.indexOf("Useful Outcome")).toBeLessThan(text.indexOf("Later assistant activity"));
  });

  it("inserts an active Outcome after its exact message before later same-turn activity", () => {
    useStore.setState({ questDetails: new Map([["q-42", quest("in_progress", 3)]]) });
    const { container } = render(<SameTurnHarness />);

    const text = container.textContent ?? "";
    expect(text.indexOf("Promoted activity")).toBeLessThan(text.indexOf("Useful Outcome"));
    expect(text.indexOf("Useful Outcome")).toBeLessThan(text.indexOf("Later same-turn activity"));
    expect(screen.getByText("Later same-turn activity")).toBeVisible();
  });

  it("collapses completed covered history, keeps the quiz visible once, and reveals history on demand", () => {
    const messages = [message("a3", "Earlier activity", 3), message("a7", "Completion\n\n{[(Quest Quiz: q-42)]}", 7)];
    useStore.setState({
      questDetails: new Map([["q-42", quest("done", 7)]]),
      quests: [quest("done", 7)],
    });
    render(<Harness status="done" messages={messages} anchorIndex={7} />);

    expect(screen.getByText("Earlier activity")).not.toBeVisible();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    const toggle = screen.getByTestId("quest-outcome-history-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByText("Earlier activity")).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(within(toggle).getByText("Loaded history")).toBeVisible();
  });
  it("does not present an active draft as a delivered Outcome after cancellation", () => {
    const cancelled = { ...quest("done", 7), cancelled: true } as QuestmasterTask;
    useStore.setState({ questDetails: new Map([["q-42", cancelled]]) });

    render(<Harness status="done" messages={[message("a7", "Cancelled", 7)]} anchorIndex={7} />);

    expect(screen.queryByTestId("quest-outcome-card")).toBeNull();
  });

  it("reveals covered history before a deep-link target is scrolled", () => {
    const messages = [message("a3", "Deep-linked earlier activity", 3), message("a7", "Completion", 7)];
    useStore.setState({ questDetails: new Map([["q-42", quest("done", 7)]]) });

    render(<Harness status="done" messages={messages} anchorIndex={7} scrollTargets={["a3"]} />);

    expect(screen.getByText("Deep-linked earlier activity")).toBeVisible();
    expect(screen.getByTestId("quest-outcome-history-toggle")).toHaveAttribute("aria-expanded", "true");
  });
});
