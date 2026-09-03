import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import { THREAD_WINDOW_SUPPORT_RECORD_LIMIT } from "../../shared/thread-window.js";
import { sendThreadWindowSync } from "./browser-transport-controller.js";

function human(id: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp,
    threadKey,
    leaderResponseCoverageVersion: 1,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
  };
}

function assistant(
  id: string,
  text: string,
  timestamp: number,
  threadKey = "main",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    threadKey,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function createResponse(
  session: { id: string; messageHistory: BrowserIncomingMessage[] },
  threadKey: string,
  text: string,
) {
  const observedHistoryLength = session.messageHistory.length;
  const response = assistant(
    `response-${observedHistoryLength}-${text.replace(/\W/g, "")}`,
    text,
    observedHistoryLength + 10,
    threadKey,
  );
  response.leaderThreadRole = "response";
  response.leaderResponseObservedHistoryLength = observedHistoryLength;
  session.messageHistory.push(response);
  expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });
  return response;
}

function parseLast(sent: string[]) {
  return JSON.parse(sent.at(-1) ?? "null") as Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>;
}

function sendLatest(
  session: { id: string; messageHistory: BrowserIncomingMessage[] },
  threadKey: string,
  itemCount = 1,
) {
  const sent: string[] = [];
  sendThreadWindowSync(
    session,
    { send: (data) => sent.push(String(data)) },
    { threadKey, fromItem: -1, itemCount, sectionItemCount: 1, visibleItemCount: 1 },
  );
  return parseLast(sent);
}

function deliveredIds(message: Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>): string[] {
  return message.entries.flatMap((entry) => {
    if (entry.message.type === "leader_user_message" || entry.message.type === "user_message") {
      return entry.message.id ? [entry.message.id] : [];
    }
    if (entry.message.type === "assistant") return [entry.message.message.id];
    return [];
  });
}

describe("pending-batch response selected-window authority", () => {
  it("retains every current response and covered prompt anchor for a bounded Ready projection", () => {
    const session = { id: "leader", messageHistory: [human("u1", 1, "q-42")] };
    const first = createResponse(session, "q-42", "First answer.");
    session.messageHistory.push(human("u2", 3, "q-42"));
    const second = createResponse(session, "q-42", "Second answer.");
    session.messageHistory.push(human("u3", 5, "q-42"));
    const third = createResponse(session, "q-42", "Third answer.");

    const message = sendLatest(session, "q-42");

    expect(message.response_state).toMatchObject({
      threadKey: "q-42",
      pendingMessageCount: 0,
      ready: true,
      currentResponses: [
        { currentMessageId: first.message.id, coveredUserMessageIds: ["u1"] },
        { currentMessageId: second.message.id, coveredUserMessageIds: ["u2"] },
        { currentMessageId: third.message.id, coveredUserMessageIds: ["u3"] },
      ],
    });
    expect(deliveredIds(message)).toEqual(
      expect.arrayContaining(["u1", "u2", "u3", first.message.id, second.message.id, third.message.id]),
    );
  });

  it("retains old Main prompt anchors with their current responses", () => {
    const session = { id: "leader", messageHistory: [human("main-u1", 1)] };
    const response = createResponse(session, "main", "Main answer.");
    session.messageHistory.push(assistant("later", "Later activity", 20));

    const message = sendLatest(session, "main");

    expect(message.response_state?.ready).toBe(true);
    expect(deliveredIds(message)).toEqual(expect.arrayContaining(["main-u1", response.message.id]));
  });

  it("retains a separate routed Quest Quiz directive for the collapsed Ready view", () => {
    const session = { id: "leader", messageHistory: [human("u1", 1, "q-42")] };
    const response = createResponse(session, "q-42", "Answer.");
    session.messageHistory.push(assistant("quiz", "{[(Quest Quiz: q-42)]}", 20, "q-42"));
    for (let index = 0; index < 5; index += 1) {
      session.messageHistory.push(assistant(`later-${index}`, `Later ${index}`, 30 + index, "q-42"));
    }

    const message = sendLatest(session, "q-42");

    expect(message.response_state?.ready).toBe(true);
    expect(deliveredIds(message)).toEqual(expect.arrayContaining(["u1", response.message.id, "quiz"]));
  });

  it("does not backfill a Quiz directive from before the response cutover", () => {
    const session = {
      id: "leader",
      messageHistory: [assistant("legacy-quiz", "{[(Quest Quiz: q-42)]}", 1, "q-42"), human("u1", 2, "q-42")],
    };
    const response = createResponse(session, "q-42", "Answer.");
    for (let index = 0; index < 5; index += 1) {
      session.messageHistory.push(assistant(`later-${index}`, `Later ${index}`, 30 + index, "q-42"));
    }

    const message = sendLatest(session, "q-42");

    expect(message.response_state?.cutoverHistoryIndex).toBe(1);
    expect(deliveredIds(message)).toEqual(expect.arrayContaining(["u1", response.message.id]));
    expect(deliveredIds(message)).not.toContain("legacy-quiz");
  });

  it("fails closed to the ordinary bounded window when response support exceeds the cap", () => {
    const session = { id: "leader", messageHistory: [] as BrowserIncomingMessage[] };
    for (let index = 0; index <= THREAD_WINDOW_SUPPORT_RECORD_LIMIT / 2; index += 1) {
      session.messageHistory.push(human(`u${index}`, index * 2 + 1, "q-42"));
      createResponse(session, "q-42", `Answer ${index}.`);
    }

    const message = sendLatest(session, "q-42");

    expect(message.response_state).toBeUndefined();
    expect(message.entries.length).toBeLessThan(THREAD_WINDOW_SUPPORT_RECORD_LIMIT);
  });

  it("sends response state even on a cache hit", () => {
    const session = { id: "leader", messageHistory: [human("u1", 1)] };
    const response = createResponse(session, "main", "Answer.");
    const sent: string[] = [];
    const socket = { send: (data: string) => sent.push(data) };
    const options = { threadKey: "main", fromItem: -1, itemCount: 1, sectionItemCount: 1, visibleItemCount: 1 };

    sendThreadWindowSync(session, socket, options);
    const first = parseLast(sent);
    sendThreadWindowSync(session, socket, { ...options, cachedWindowHash: first.window.window_hash });
    const cached = parseLast(sent);

    expect(cached.cache_hit).toBe(true);
    expect(cached.entries).toEqual([]);
    expect(cached.response_state?.currentResponses[0]).toMatchObject({ currentMessageId: response.message.id });
  });

  it("omits malformed response authority and leaves its covered prompt pending", () => {
    const session = { id: "leader", messageHistory: [human("u1", 1)] };
    const response = createResponse(session, "main", "Answer.");
    response.message.content = [{ type: "text", text: "Tampered." }];

    expect(sendLatest(session, "main").response_state).toMatchObject({
      pendingMessageCount: 1,
      currentResponses: [],
      ready: false,
    });
  });
});
