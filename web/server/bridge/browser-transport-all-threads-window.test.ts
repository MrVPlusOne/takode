import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { buildThreadWindowSync, latestThreadWindowStartHistoryIndex } from "../../shared/thread-window.js";
import { isRootAgentHistoryMessage } from "../root-agent-feed-message.js";
import { sendHistoryWindowSync } from "./browser-transport-controller.js";

// All Threads uses the session history window, sized in backend turns, while
// Main uses a thread window sized in Main conversations. Every herd event is a
// backend turn, so on a herd-heavy leader the latest turns covered a far shorter
// span than Main's latest conversations and All Threads looked shorter than Main.

const result = () =>
  ({
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      session_id: "leader",
    },
  }) as BrowserIncomingMessage;

const assistant = (id: string, text: string, timestamp: number, threadKey?: string) =>
  ({
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    ...(threadKey
      ? {
          threadKey,
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
        }
      : {}),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }) as BrowserIncomingMessage;

/** A user conversation in Main followed by many herd-event turns routed to a quest, as stored by the server. */
function herdHeavyLeaderHistory(mainConversations: number, herdTurnsAfterEach: number): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  let time = 1_000;
  for (let conversation = 0; conversation < mainConversations; conversation++) {
    history.push({
      type: "user_message",
      id: `main-${conversation}`,
      content: `Main ask ${conversation}`,
      timestamp: time++,
    });
    history.push(assistant(`main-answer-${conversation}`, `Main answer ${conversation}`, time++));
    history.push(result());
    for (let event = 0; event < herdTurnsAfterEach; event++) {
      history.push({
        type: "user_message",
        id: `herd-${conversation}-${event}`,
        content: `1 event from 1 session\n\n#7 | turn_end | q-7 worker progress ${event}`,
        timestamp: time++,
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
        threadKey: "q-7",
        questId: "q-7",
        threadRefs: [{ threadKey: "q-7", questId: "q-7", source: "explicit" }],
      } as BrowserIncomingMessage);
      history.push(assistant(`herd-reply-${conversation}-${event}`, "Noted.", time++, "q-7"));
      history.push(result());
    }
  }
  return history;
}

function sendWindow(
  messageHistory: BrowserIncomingMessage[],
  options: Parameters<typeof sendHistoryWindowSync>[2],
): Extract<BrowserIncomingMessage, { type: "history_window_sync" }> {
  const send = vi.fn();
  sendHistoryWindowSync({ messageHistory, state: { isOrchestrator: true } }, { send }, options);
  return JSON.parse(send.mock.calls[0]![0]);
}

function mainLatestWindowIndexes(history: BrowserIncomingMessage[], itemCount: number): number[] {
  const main = buildThreadWindowSync({
    messageHistory: history,
    threadKey: "main",
    fromItem: -1,
    itemCount,
    sectionItemCount: itemCount,
    visibleItemCount: 1,
    includeMessage: isRootAgentHistoryMessage,
  });
  return main.entries.map((entry) => entry.history_index);
}

describe("All Threads history window", () => {
  it("reaches back at least as far as the latest Main window when herd turns crowd the latest turns", () => {
    // 4 Main conversations, each followed by 20 herd turns: the latest 3 turns
    // are all herd events, while Main's latest 3 conversations reach far back.
    const history = herdHeavyLeaderHistory(4, 20);
    const allWindow = sendWindow(history, {
      fromTurn: -1,
      turnCount: 3,
      sectionTurnCount: 3,
      visibleSectionCount: 1,
    });

    // Contiguous window rows carry no index of their own; they follow start_index.
    const allIndexes = new Set(
      allWindow.messages.map((message, offset) => message.history_index ?? allWindow.window.start_index + offset),
    );
    const mainIndexes = mainLatestWindowIndexes(history, 3);
    expect(mainIndexes.length).toBeGreaterThan(0);
    expect(mainIndexes.filter((index) => !allIndexes.has(index))).toEqual([]);
    // The window still runs through the latest turn and states its real extent.
    expect(allWindow.window.has_newer_items).toBe(false);
    expect(allWindow.window.from_turn + allWindow.window.turn_count).toBe(allWindow.window.total_turns);
    expect(allWindow.window.turn_count).toBeGreaterThan(3);
    expect(allWindow.window.start_index).toBe(latestThreadWindowStartHistoryIndex(history, "main", 3));
  });

  it("leaves ordinary sessions, which have no Main thread, at the requested turns", () => {
    const history = herdHeavyLeaderHistory(4, 20);
    const send = vi.fn();
    sendHistoryWindowSync(
      { messageHistory: history },
      { send },
      {
        fromTurn: -1,
        turnCount: 3,
        sectionTurnCount: 3,
        visibleSectionCount: 1,
      },
    );
    expect(JSON.parse(send.mock.calls[0]![0]).window).toMatchObject({ turn_count: 3 });
  });

  it("keeps the requested size when the latest turns already cover Main", () => {
    // Main conversations only: the latest turns are the latest Main conversations.
    const history = herdHeavyLeaderHistory(6, 0);
    const allWindow = sendWindow(history, {
      fromTurn: -1,
      turnCount: 3,
      sectionTurnCount: 3,
      visibleSectionCount: 1,
    });
    expect(allWindow.window).toMatchObject({
      from_turn: 3,
      turn_count: 3,
      total_turns: 6,
    });
  });

  it("leaves older pages and message-targeted windows at their requested turns", () => {
    const history = herdHeavyLeaderHistory(4, 20);
    // An older page that stops before the latest turn is where the user scrolled to.
    const olderPage = sendWindow(history, {
      fromTurn: 10,
      turnCount: 3,
      sectionTurnCount: 3,
      visibleSectionCount: 1,
    });
    expect(olderPage.window).toMatchObject({ from_turn: 10, turn_count: 3 });

    // A window centred on a message stays centred on it.
    const targeted = sendWindow(history, {
      fromTurn: -1,
      turnCount: 3,
      sectionTurnCount: 3,
      visibleSectionCount: 1,
      targetMessageId: "herd-3-19",
    });
    expect(targeted.window.turn_count).toBe(3);
    expect(targeted.messages.some((message) => (message as { id?: string }).id === "herd-3-19")).toBe(true);
  });
});
