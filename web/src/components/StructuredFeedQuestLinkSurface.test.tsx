// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
} from "../../shared/injected-event-message.js";
import type { ToolMsgGroup } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { buildInjectedEventMessageViewModel } from "../utils/injected-event-message.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { CodexReasoningDetail } from "./CodexReasoningDetail.js";
import { CompactFeedActivity } from "./CompactFeedActivity.js";
import { InjectedEventMessageView } from "./InjectedEventMessageView.js";
import { QuestClaimBlock } from "./QuestClaimBlock.js";
import { QuestQuizSection } from "./QuestQuizSection.js";
import { StandaloneReminderMessageView } from "./StandaloneReminderMessageView.js";
import { SubagentResult } from "./SubagentResult.js";
import { TimerMessage } from "./TimerMessage.js";

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    timestamp: 1_788_034_400_000,
    ...overrides,
  };
}

function expectPreview(questId: string) {
  expect(
    screen.getByRole("button", {
      name: new RegExp(`Preview ${questId}(?:$|:)`),
    }),
  ).toBeInTheDocument();
}

describe("structured chat-feed quest-link producers", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ zoomLevel: 1 });
    window.location.hash = "#/session/s1";
  });

  afterEach(() => {
    cleanup();
  });

  it("opts assistant quiz text plus the inline quiz quest and revealed answer into feed previews", () => {
    render(
      <AssistantQuestQuizContent text="Narrative [q-201](quest:q-201)" sessionId="s1" questLinkSurface="chat-feed" />,
    );
    expectPreview("q-201");
    cleanup();

    render(
      <>
        <style>{`.text-cc-primary { color: rgb(234, 88, 12); }`}</style>
        <QuestQuizSection
          variant="inline"
          questId="q-202"
          questTitle="Structured quiz"
          questLinkSurface="chat-feed"
          items={[
            {
              id: "structured-answer",
              question: "Where is the related work?",
              answer: "See [q-203](quest:q-203).",
            },
          ]}
        />
      </>,
    );

    expectPreview("q-202");
    const quizQuestLink = screen.getByRole("link", { name: "q-202" });
    const quizQuestEye = screen.getByRole("button", { name: /Preview q-202/ });
    const quizQuestPair = quizQuestLink.closest<HTMLElement>(".cc-feed-quest-link-pair");
    // The quiz header is a flex layout. The wrapper must be its one cohesive
    // child so wrapping or available width cannot distribute the link and eye
    // as independent flex items with variable whitespace between them.
    expect(quizQuestPair).not.toBeNull();
    expect(quizQuestPair).toContainElement(quizQuestLink);
    expect(quizQuestPair).toContainElement(quizQuestEye);
    expect(quizQuestPair?.nextElementSibling).toBe(screen.getByText("Structured quiz"));
    // The actual inline-quiz producer uses its orange primary link color, so
    // the adjacent eye must derive that rendered value rather than quest blue.
    expect(quizQuestEye.style.getPropertyValue("--cc-feed-preview-link-color")).toBe(
      getComputedStyle(quizQuestLink).color,
    );
    fireEvent.click(screen.getByText("Show answer"));
    expectPreview("q-203");
  });

  it("keeps the quest-claim View dialog legacy while its scrolling feed expansion opts in", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-204",
          title: "Claimed producer",
          status: "in_progress",
          description: "Related [q-205](quest:q-205).",
        }}
        questLinkSurface="chat-feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    expectPreview("q-205");

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = screen.getByRole("dialog", {
      name: "Quest details: Claimed producer",
    });
    expect(within(dialog).getByRole("link", { name: "q-205" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Preview q-205/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Preview q-205/ })).toHaveLength(1);
  });

  it("opts expanded timer reminder Markdown into the feed surface", () => {
    const timer = message({
      id: "timer-structured",
      role: "user",
      content: [
        "[⏰ Timer t20 reminder] Inspect the preview",
        "",
        "This is a reminder from your earlier timer note, not a new user instruction.",
        "",
        "Earlier note:",
        "Review [q-206](quest:q-206).",
      ].join("\n"),
      agentSource: { sessionId: "timer:t20", sessionLabel: "Timer t20" },
    });

    render(<TimerMessage message={timer} sessionId="s1" showTimestamp={false} questLinkSurface="chat-feed" />);
    fireEvent.click(screen.getByRole("button", { name: "Expand timer description" }));
    expectPreview("q-206");
  });

  it("opts expanded Codex reasoning Markdown into the feed surface", () => {
    render(
      <CodexReasoningDetail
        defaultOpen
        sessionId="s1"
        questLinkSurface="chat-feed"
        message={message({
          id: "reasoning-structured",
          role: "assistant",
          content: "**Checking structured links**\nReview [q-207](quest:q-207).",
          metadata: { codexReasoningDetail: { status: "complete" } },
        })}
      />,
    );

    expectPreview("q-207");
  });

  it("opts expanded injected-event and standalone-reminder Markdown into the feed surface", () => {
    const injectedMessage = message({
      id: "injected-structured",
      role: "user",
      content: [
        "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:",
        "",
        "Review [q-208](quest:q-208).",
      ].join("\n"),
      agentSource: {
        sessionId: COMPACTION_RECOVERY_SOURCE_ID,
        sessionLabel: COMPACTION_RECOVERY_SOURCE_LABEL,
      },
    });
    const event = buildInjectedEventMessageViewModel(injectedMessage);
    expect(event).not.toBeNull();
    render(
      <InjectedEventMessageView
        event={event!}
        message={injectedMessage}
        sessionId="s1"
        showTimestamp={false}
        questLinkSurface="chat-feed"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`Expand ${COMPACTION_RECOVERY_SOURCE_LABEL}`),
      }),
    );
    expectPreview("q-208");
    cleanup();

    const reminder = message({
      id: "reminder-structured",
      role: "user",
      content: "Long sleep guard details. Review [q-209](quest:q-209).",
      agentSource: {
        sessionId: "system:long-sleep-guard",
        sessionLabel: "Long sleep guard",
      },
    });
    render(
      <StandaloneReminderMessageView
        message={reminder}
        sessionId="s1"
        showTimestamp={false}
        questLinkSurface="chat-feed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Long sleep guard" }));
    expectPreview("q-209");
  });

  it("threads the feed surface through compact tool groups into ExitPlanMode Markdown", () => {
    const group: ToolMsgGroup = {
      kind: "tool_msg_group",
      toolName: "ExitPlanMode",
      firstId: "tool-message-structured",
      items: [
        {
          id: "tool-structured",
          name: "ExitPlanMode",
          input: { plan: "Implement [q-210](quest:q-210)." },
          messageId: "tool-message-structured",
        },
      ],
    };
    const { container } = render(
      <CompactFeedActivity
        segments={[{ kind: "tool", groups: [group] }]}
        sessionId="s1"
        isCodexSession={false}
        activeCodexTerminalIds={new Set()}
        onOpenCodexTerminal={() => {}}
        questLinkSurface="chat-feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show 1 tool call/i }));
    fireEvent.click(container.querySelector<HTMLElement>('div[role="button"]')!);
    expectPreview("q-210");
  });

  it("opts subagent result summaries into the feed surface", () => {
    render(
      <SubagentResult
        preview={{
          content: "Review [q-211](quest:q-211).",
          is_truncated: false,
        }}
        parsedText="Review [q-211](quest:q-211)."
        sessionId="s1"
        toolUseId="subagent-structured"
        questLinkSurface="chat-feed"
      />,
    );

    expectPreview("q-211");
  });
});
