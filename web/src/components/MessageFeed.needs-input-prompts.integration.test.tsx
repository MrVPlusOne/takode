// @vitest-environment jsdom

// Collapsed leader turns keep the thread's needs-input prompts (open or answered)
// beside the turn's answers, from producer-shaped windows and notification state.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import {
  QUEST_ID,
  SESSION_ID,
  assistantMessage,
  leaderSession,
  quest,
  responseMessage,
  routedFields,
  toolMessage,
  userMessage,
} from "../test-fixtures/leader-thread-response-messages.js";
import { MessageFeed } from "./MessageFeed.js";

const apiMocks = vi.hoisted(() => ({
  getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"response-detail"' }),
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));

vi.mock("../api.js", () => ({ api: apiMocks }));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

const UNRESOLVED_PROMPT_ONE_ID = "needs-input-prompt-one";
const UNRESOLVED_PROMPT_TWO_ID = "needs-input-prompt-two";
const STALE_EMBEDDED_PROMPT_ID = "stale-embedded-needs-input-prompt";
const STALE_HERD_ANCHOR_ID = "stale-herd-anchor";

function producerAnswerWithUnresolvedNeedsInputPrompts(): Extract<
  BrowserIncomingMessage,
  { type: "thread_window_sync" }
> {
  const currentAnswer = responseMessage({
    id: "answer-before-needs-input",
    observedHistoryLength: 43,
    coveredUserMessageIds: ["user-later-answered"],
    content: "The clarification is answered before the next decision.",
    timestamp: 1_700_000_003_000,
  });
  const staleEmbeddedPrompt = assistantMessage(
    STALE_EMBEDDED_PROMPT_ID,
    "Stale embedded prompt must not override authoritative notification state.",
    1_700_000_004_000,
    undefined,
    "commentary",
  );
  staleEmbeddedPrompt.notification = {
    id: "n-stale-embedded",
    category: "needs-input",
    timestamp: 1_700_000_004_000,
    summary: "Stale embedded decision",
  };
  const firstPrompt = assistantMessage(
    UNRESOLVED_PROMPT_ONE_ID,
    "Choose the deployment boundary.\n\nOption A keeps the current release; option B pauses for another review.",
    1_700_000_005_000,
    undefined,
    "commentary",
  );
  firstPrompt.notification = {
    id: "n-outdated-prompt-snapshot",
    category: "needs-input",
    timestamp: 1_700_000_004_500,
    summary: "Outdated embedded prompt snapshot",
  };
  const secondPrompt = assistantMessage(
    UNRESOLVED_PROMPT_TWO_ID,
    "Confirm whether the follow-up should remain parked while the first choice is unresolved.",
    1_700_000_007_000,
    undefined,
    "commentary",
  );
  const quiz = assistantMessage(
    "needs-input-quiz",
    `{[(Quest Quiz: ${QUEST_ID})]}`,
    1_700_000_008_000,
    undefined,
    "commentary",
  );
  const staleHerdAnchor: Extract<BrowserIncomingMessage, { type: "user_message" }> = {
    type: "user_message",
    id: STALE_HERD_ANCHOR_ID,
    content: "1 event from 1 session\n\n#2594 | turn_end | complete",
    timestamp: 1_700_000_009_000,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...routedFields(),
  };
  const entries = [
    {
      history_index: 40,
      message: userMessage("user-older-pending", "Older implementation request", 1_700_000_001_000),
    },
    { history_index: 41, message: userMessage("user-later-answered", "Later clarification", 1_700_000_002_000) },
    { history_index: 42, message: currentAnswer },
    { history_index: 43, message: staleEmbeddedPrompt },
    { history_index: 44, message: firstPrompt },
    { history_index: 45, message: toolMessage("needs-input-tool", "needs-input-tool-use", 1_700_000_006_000) },
    { history_index: 46, message: secondPrompt },
    { history_index: 47, message: quiz },
    { history_index: 48, message: staleHerdAnchor },
  ];
  return {
    type: "thread_window_sync",
    thread_key: QUEST_ID,
    entries,
    window: {
      thread_key: QUEST_ID,
      from_item: 0,
      item_count: entries.length,
      total_items: entries.length,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 49,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey: QUEST_ID,
      cutoverHistoryIndex: 40,
      pendingMessageCount: 1,
      pendingMessages: [
        { userMessageId: "u1", historyMessageId: "user-older-pending", historyIndex: 40, askedAt: 1_700_000_001_000 },
      ],
      currentAnswers: [
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u2"],
          referencedUserMessageIds: ["user-later-answered"],
          coveredAnswerUserMessageIds: ["u2"],
          coveredUserMessageIds: ["user-later-answered"],
          currentMessageId: "answer-before-needs-input",
          currentHistoryIndex: 42,
          createdAt: 1_700_000_003_000,
          updatedAt: 1_700_000_003_000,
          source: "explicit",
        },
      ],
      ready: false,
    },
  };
}

function needsInputNotificationUpdate(
  notifications: Array<{
    id: string;
    messageId: string | null;
    summary: string;
    done?: boolean;
    muted?: boolean;
    threadKey?: string;
  }>,
): Extract<BrowserIncomingMessage, { type: "notification_update" }> {
  return {
    type: "notification_update",
    notifications: notifications.map((notification, index) => ({
      category: "needs-input",
      timestamp: 1_700_000_010_000 + index,
      done: false,
      threadKey: QUEST_ID,
      questId: QUEST_ID,
      ...notification,
      ...(notification.threadKey === "main" ? { questId: undefined } : {}),
    })),
    notificationStatusVersion: 10,
  };
}

describe("MessageFeed needs-input prompts in collapsed turns", () => {
  beforeEach(() => {
    apiMocks.getQuestValidated.mockClear();
    sendToSession.mockClear();
  });

  it("keeps exact needs-input prompts beside a current answer and Quiz, open or answered", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerAnswerWithUnresolvedNeedsInputPrompts());
      handleMessage(
        SESSION_ID,
        needsInputNotificationUpdate([
          { id: "n-prompt-one", messageId: UNRESOLVED_PROMPT_ONE_ID, summary: "Choose deployment boundary" },
          {
            id: "n-prompt-two",
            messageId: UNRESOLVED_PROMPT_TWO_ID,
            summary: "Confirm follow-up state",
            muted: true,
          },
        ]),
      );
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const turn = screen.getByText("Later clarification").closest<HTMLElement>("[data-turn-id]")!;

    fireEvent.click(within(turn).getByRole("button", { name: /Hide turn activity/ }));

    const answer = within(turn).getByText("The clarification is answered before the next decision.");
    const firstPrompt = within(turn).getByText(/Choose the deployment boundary/);
    const secondPrompt = within(turn).getByText(/Confirm whether the follow-up should remain parked/);
    expect(turn.textContent?.indexOf(answer.textContent ?? "")).toBeLessThan(
      turn.textContent?.indexOf(firstPrompt.textContent ?? "") ?? -1,
    );
    expect(turn.textContent?.indexOf(firstPrompt.textContent ?? "")).toBeLessThan(
      turn.textContent?.indexOf(secondPrompt.textContent ?? "") ?? -1,
    );
    expect(view.container.querySelectorAll('[data-message-id="answer-before-needs-input"]')).toHaveLength(1);
    expect(view.container.querySelectorAll(`[data-message-id="${UNRESOLVED_PROMPT_ONE_ID}"]`)).toHaveLength(1);
    expect(view.container.querySelectorAll(`[data-message-id="${UNRESOLVED_PROMPT_TWO_ID}"]`)).toHaveLength(1);
    expect(within(turn).queryByText(/Stale embedded prompt/)).not.toBeInTheDocument();
    expect(within(turn).getAllByTestId("thread-response-needs-input-prompt")).toHaveLength(2);
    expect(within(turn).getAllByTestId("thread-response-answer-count")).toHaveLength(1);
    expect(within(turn).getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 1 message");
    expect(within(turn).getByText("Choose deployment boundary")).toBeVisible();
    expect(within(turn).queryByText("Outdated embedded prompt snapshot")).not.toBeInTheDocument();
    expect(within(turn).getByText("Confirm follow-up state")).toBeVisible();
    expect(within(turn).getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(within(turn).getAllByRole("button", { name: /Show turn activity.*1 tool/ })).toHaveLength(1);
    expect(within(turn).queryByLabelText(/Thread Ready/)).not.toBeInTheDocument();

    act(() => {
      handleMessage(
        SESSION_ID,
        needsInputNotificationUpdate([
          {
            id: "n-prompt-one",
            messageId: UNRESOLVED_PROMPT_ONE_ID,
            summary: "Choose deployment boundary",
            done: true,
          },
          {
            id: "n-prompt-two",
            messageId: UNRESOLVED_PROMPT_TWO_ID,
            summary: "Confirm follow-up state",
            muted: true,
          },
        ]),
      );
    });
    // Answering a prompt keeps it, and its card, in the collapsed turn: the user's
    // next message usually answers it and reads poorly without it.
    expect(within(turn).getByText(/Choose the deployment boundary/)).toBeVisible();
    expect(within(turn).getByText(/Confirm whether the follow-up should remain parked/)).toBeVisible();

    act(() => {
      handleMessage(
        SESSION_ID,
        needsInputNotificationUpdate([
          {
            id: "n-prompt-one",
            messageId: UNRESOLVED_PROMPT_ONE_ID,
            summary: "Choose deployment boundary",
            done: true,
          },
          {
            id: "n-prompt-two",
            messageId: UNRESOLVED_PROMPT_TWO_ID,
            summary: "Confirm follow-up state",
            muted: true,
            done: true,
          },
        ]),
      );
    });
    expect(within(turn).getByText(/Choose the deployment boundary/)).toBeVisible();
    expect(within(turn).getByText(/Confirm whether the follow-up should remain parked/)).toBeVisible();
    expect(within(turn).getByText("Choose deployment boundary")).toBeVisible();
    expect(within(turn).getByText("Confirm follow-up state")).toBeVisible();
    expect(within(turn).getAllByTestId("thread-response-needs-input-prompt")).toHaveLength(2);
    expect(within(turn).getByText("The clarification is answered before the next decision.")).toBeVisible();
    expect(within(turn).getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(within(turn).getAllByRole("button", { name: /Show turn activity.*1 tool/ })).toHaveLength(1);
  });

  it("fails closed for wrong-thread, missing, and stale herd needs-input anchor targets", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerAnswerWithUnresolvedNeedsInputPrompts());
      handleMessage(
        SESSION_ID,
        needsInputNotificationUpdate([
          {
            id: "n-wrong-thread",
            messageId: UNRESOLVED_PROMPT_ONE_ID,
            summary: "Wrong owner",
            threadKey: "main",
          },
          { id: "n-missing", messageId: "missing-anchor", summary: "Missing source" },
          { id: "n-stale-herd", messageId: STALE_HERD_ANCHOR_ID, summary: "Stale herd source" },
        ]),
      );
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const turn = screen.getByText("Later clarification").closest<HTMLElement>("[data-turn-id]")!;

    fireEvent.click(within(turn).getByRole("button", { name: /Hide turn activity/ }));

    expect(within(turn).getByText("The clarification is answered before the next decision.")).toBeVisible();
    expect(within(turn).queryByText(/Choose the deployment boundary/)).not.toBeInTheDocument();
    expect(within(turn).queryByText(/Confirm whether the follow-up should remain parked/)).not.toBeInTheDocument();
    expect(within(turn).queryByText(/Stale embedded prompt/)).not.toBeInTheDocument();
    expect(view.container.querySelectorAll(`[data-message-id="${STALE_HERD_ANCHOR_ID}"]`)).toHaveLength(0);
    expect(within(turn).queryByTestId("thread-response-needs-input-prompt")).not.toBeInTheDocument();
    expect(within(turn).getAllByTestId("thread-response-answer-count")).toHaveLength(1);
    expect(within(turn).getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(within(turn).getAllByRole("button", { name: /Show turn activity.*1 tool/ })).toHaveLength(1);
  });
});
