import { describe, expect, it } from "vitest";
import { threadInteractionTimes, topicInteractionAt } from "./topic-interaction.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";

/**
 * The sessions panel's Topics mode orders topics by the rule Recent orders leaders by: when the user
 * and the thread last dealt with each other (their own message, or the leader answering or asking
 * them there). Commentary and herd events don't move a topic.
 */
const user = (threadKey: string, timestamp: number, extra: Record<string, unknown> = {}) =>
  ({ type: "user_message", content: "hi", timestamp, threadKey, ...extra }) as unknown as BrowserIncomingMessage;
const assistant = (threadKey: string, timestamp: number, extra: Record<string, unknown> = {}) =>
  ({
    type: "assistant",
    timestamp,
    threadKey,
    message: { content: [] },
    ...extra,
  }) as unknown as BrowserIncomingMessage;

describe("threadInteractionTimes", () => {
  it("counts the user's messages, answers to them and questions, and nothing else", () => {
    const history = [
      user("q-1", 100),
      assistant("q-1", 150), // commentary
      user("q-2", 200, { agentSource: { sessionId: "herd-events" } }), // a herd event
      assistant("q-2", 300, { threadAnswer: { answerUserMessageIds: ["u7"] } }), // an answer
      assistant("topic:abcdef12", 400, { notification: { category: "needs-input", summary: "?" } }), // a question
    ];
    const times = threadInteractionTimes(history);
    expect(Object.fromEntries(times)).toEqual({ "q-1": 100, "q-2": 300, "topic:abcdef12": 400 });
  });

  it("reads only new messages into what it already knows", () => {
    const history = [user("q-1", 100)];
    const times = threadInteractionTimes(history);
    history.push(user("q-1", 500), user("q-3", 600));
    threadInteractionTimes(history, 1, times);
    expect(Object.fromEntries(times)).toEqual({ "q-1": 500, "q-3": 600 });
  });
});

describe("topicInteractionAt", () => {
  it("takes the latest of its own thread, its quests, a finished quest and its creation", () => {
    const topic = { id: "abcdef12-0000-0000-0000-000000000000", createdAt: 50, questIds: ["q-1", "q-2"] };
    const quests = new Map([
      ["q-2", { questId: "q-2", status: "done", statusChangedAt: 900 } as unknown as QuestmasterTask],
    ]);
    expect(topicInteractionAt(topic, new Map([["q-1", 300]]), new Map())).toBe(300);
    expect(topicInteractionAt(topic, new Map([["topic:abcdef12", 700]]), new Map())).toBe(700);
    // A quest finishing there asks for the user, as an unread result does for a leader.
    expect(topicInteractionAt(topic, new Map([["q-1", 300]]), quests)).toBe(900);
    expect(topicInteractionAt(topic, new Map(), new Map())).toBe(50);
  });
});
