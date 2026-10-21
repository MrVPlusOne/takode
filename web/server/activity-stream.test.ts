import { describe, expect, it } from "vitest";
import { buildActivityStream, buildSessionActivityRecord, type ActivitySessionDocument } from "./activity-stream.js";
import type { BrowserIncomingMessage } from "./session-types.js";

// Producer-shaped history rows: the fields the bridge persists for human input,
// injected input, assistant replies, settled leader answers and turn results.
function user(content: string, timestamp: number, extra: Record<string, unknown> = {}): BrowserIncomingMessage {
  return { type: "user_message", id: `user-${timestamp}`, content, timestamp, ...extra } as BrowserIncomingMessage;
}

function leaderUser(id: string, content: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return user(content, timestamp, {
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: id,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
  });
}

function injected(content: string, timestamp: number): BrowserIncomingMessage {
  return user(content, timestamp, { agentSource: { sessionId: "leader-1", sessionLabel: "#1" } });
}

function assistant(text: string, timestamp: number, extra: Record<string, unknown> = {}): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: `assistant-${timestamp}`,
      type: "message",
      role: "assistant",
      model: "test",
      content: text
        ? [{ type: "text", text }]
        : [{ type: "tool_use", id: `tool-${timestamp}`, name: "Bash", input: {} }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp,
    ...extra,
  } as BrowserIncomingMessage;
}

function leaderAnswer(text: string, timestamp: number, ids: string[], threadKey = "main"): BrowserIncomingMessage {
  return assistant(text, timestamp, {
    threadKey,
    threadAnswer: { version: 2, answerUserMessageIds: ids, observedHistoryLength: 0, authoredThreadKey: threadKey },
  });
}

function report(content: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "markdown_report",
    id: `report-${timestamp}`,
    timestamp,
    content,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    source: { sessionId: "session-1", reportId: `report-${timestamp}`, sourcePath: "/tmp/report.md", sha256: "0" },
  } as BrowserIncomingMessage;
}

function result(options: { retry?: boolean } = {}): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      ...(options.retry
        ? {
            codex_provider_retry: {
              family: "model_backend_stream_error",
              ownerId: "u1",
              attempt: 1,
              maxAttempts: 2,
              startedAt: 0,
            },
          }
        : {}),
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "result",
      session_id: "s",
    },
  } as BrowserIncomingMessage;
}

function doc(
  messageHistory: BrowserIncomingMessage[],
  extra: Partial<ActivitySessionDocument> = {},
): ActivitySessionDocument {
  return {
    sessionId: "session-1",
    sessionNum: 7,
    sessionName: "Worker",
    space: "Takode",
    isOrchestrator: false,
    messageHistory,
    ...extra,
  };
}

const roles = (messages: Array<{ role: string; index: number; to?: number[] }>) =>
  messages.map((message) =>
    message.to ? `${message.role}:${message.index}->${message.to.join(",")}` : `${message.role}:${message.index}`,
  );

describe("buildActivityStream", () => {
  it("answers the user messages of one turn with the turn's last reply, ignoring injected input", () => {
    // Two user messages land in one turn; progress text and a leader message do not
    // count, and a provider retry result does not end the turn.
    const threads = buildActivityStream({
      documents: [
        doc([
          injected("Leader dispatch", 100),
          assistant("Working on the dispatch", 110),
          result(),
          user("Please fix the bug", 200),
          assistant("Looking now", 210),
          user("Also check the tests", 220),
          result({ retry: true }),
          assistant("", 230),
          assistant("Fixed the bug and the tests pass.", 240),
          result(),
          user("Thanks, one more thing", 300),
        ]),
      ],
      since: 0,
      until: 1000,
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ session: 7, sessionName: "Worker", space: "Takode" });
    expect(threads[0]!.thread).toBeUndefined();
    expect(roles(threads[0]!.messages)).toEqual(["user:3", "user:5", "answer:8->3,5", "user:10"]);
    expect(threads[0]!.messages[2]!.text).toBe("Fixed the bug and the tests pass.");
  });

  it("joins leader messages to the settled explicit answers that name them, in the asking thread", () => {
    // Commentary is not an answer even when it ends the turn. The answer covering u1 and u2
    // was stored under Main for display, but joins the quest thread its requests belong to.
    const threads = buildActivityStream({
      documents: [
        doc(
          [
            leaderUser("u1", "Fix the sidebar", 100, "q-5"),
            assistant("Dispatching a worker", 110, { threadKey: "q-5" }),
            result(),
            leaderUser("u2", "Also the top bar", 200, "q-5"),
            leaderUser("u3", "Unrelated question", 210),
            leaderAnswer("Here is the answer to the unrelated question.", 220, ["u3"]),
            result(),
            leaderAnswer("Both bars are fixed.", 300, ["u1", "u2"]),
            result(),
          ],
          { isOrchestrator: true, sessionName: "Leader" },
        ),
      ],
      since: 0,
      until: 1000,
    });

    expect(threads.map((thread) => thread.thread)).toEqual(["q-5", undefined]);
    expect(roles(threads[0]!.messages)).toEqual(["user:0", "user:3", "answer:7->0,3"]);
    expect(roles(threads[1]!.messages)).toEqual(["user:4", "answer:5->4"]);
  });

  it("lists leader answers that name no message and published reports in the thread they were written in", () => {
    // A no-ID answer settles with an empty ID list and is authored in q-7, though its stored
    // route was normalized to Main. Reports carry their own thread. Neither answers a user
    // message, so they carry no `to` and leave the earlier request unanswered. Only those
    // inside the window are listed, since nothing ties them to a message inside it.
    const threads = buildActivityStream({
      documents: [
        doc(
          [
            leaderUser("u1", "Check the build", 100),
            result(),
            assistant("Worker PR result: merged.", 200, {
              threadKey: "main",
              threadAnswer: {
                version: 2,
                answerUserMessageIds: [],
                observedHistoryLength: 0,
                authoredThreadKey: "q-7",
              },
            }),
            result(),
            report("# Evening briefing\n\nAll green.", 300),
            report("# Quest report", 310, "q-7"),
            report("# Before the window", 10),
          ],
          { isOrchestrator: true, sessionName: "Leader" },
        ),
        // Reports published by an ordinary session belong to that whole session.
        doc([report("# Worker report", 400, "q-9")], { sessionId: "worker", sessionNum: 8 }),
      ],
      since: 50,
      until: 1000,
    });

    expect(threads.map((thread) => [thread.session, thread.thread])).toEqual([
      [7, undefined],
      [7, "q-7"],
      [8, undefined],
    ]);
    expect(roles(threads[0]!.messages)).toEqual(["user:0", "report:4"]);
    expect(roles(threads[1]!.messages)).toEqual(["answer:2", "report:5"]);
    expect(threads[1]!.messages[0]).toEqual({ role: "answer", index: 2, at: 200, text: "Worker PR result: merged." });
    expect(threads[0]!.messages[1]!.text).toBe("# Evening briefing\n\nAll green.");
    expect(roles(threads[2]!.messages)).toEqual(["report:0"]);
  });

  it("lists messages outside the window only when they answer or are answered by one inside it", () => {
    const history = [
      user("Old question", 100),
      assistant("Old answer", 110),
      result(),
      user("Question before the window", 200),
      assistant("Answer inside the window", 600),
      result(),
      user("Question inside the window", 700),
      assistant("Answer after the window", 1200),
      result(),
    ];
    const threads = buildActivityStream({ documents: [doc(history)], since: 500, until: 1000 });

    expect(roles(threads[0]!.messages)).toEqual(["user:3", "answer:4->3", "user:6", "answer:7->6"]);
    expect(buildActivityStream({ documents: [doc(history)], since: 2000, until: 3000 })).toEqual([]);
  });

  it("shortens long messages, reporting the full length, and counts images", () => {
    const threads = buildActivityStream({
      documents: [
        doc([
          user("x".repeat(50), 100, { images: [{ imageId: "a" }, { imageId: "b" }] }),
          assistant("short", 110),
          result(),
        ]),
      ],
      since: 0,
      until: 1000,
      textLimit: 10,
    });

    expect(threads[0]!.messages[0]).toEqual({
      role: "user",
      index: 0,
      at: 100,
      text: `${"x".repeat(10)}…`,
      chars: 50,
      images: 2,
    });
    expect(threads[0]!.messages[1]).toMatchObject({ text: "short" });
    expect(threads[0]!.messages[1]!.chars).toBeUndefined();
  });

  it("orders threads across sessions by their first listed message", () => {
    const threads = buildActivityStream({
      documents: [
        doc([user("Later session", 500)], { sessionId: "b", sessionNum: 2 }),
        doc([user("Earlier session", 100)], { sessionId: "a", sessionNum: 1 }),
      ],
      since: 0,
      until: 1000,
    });

    expect(threads.map((thread) => thread.session)).toEqual([1, 2]);
  });

  it("matches a fresh read after the same history grows, shrinks or has a row inserted", () => {
    // The stream keeps per-history facts between calls; changing the history must give the same
    // result as reading a copy of it from scratch.
    const history: BrowserIncomingMessage[] = [user("First question", 100), assistant("First answer", 110), result()];
    const window = { since: 0, until: 10_000 };
    const fresh = () => buildActivityStream({ documents: [doc([...history])], ...window });
    const cached = () => buildActivityStream({ documents: [doc(history)], ...window });
    expect(cached()).toEqual(fresh());

    history.push(user("Second question", 200), assistant("Second answer", 210), result());
    expect(roles(cached()[0]!.messages)).toEqual(["user:0", "answer:1->0", "user:3", "answer:4->3"]);
    expect(cached()).toEqual(fresh());

    history.splice(1, 0, user("Inserted question", 105));
    expect(cached()).toEqual(fresh());

    history.length = 3;
    expect(cached()).toEqual(fresh());
  });

  it("reads only from the turn holding the window's first message, yet still lists older asks it answers", () => {
    // Everything before the window is skipped except the turn the window starts in, whose earlier
    // question is answered inside the window.
    const history = [
      user("Long ago", 100),
      assistant("Answered long ago", 110),
      result(),
      user("Asked before the window", 400),
      assistant("Answered inside it", 600),
      result(),
    ];
    const threads = buildActivityStream({ documents: [doc(history)], since: 500, until: 1000 });
    expect(roles(threads[0]!.messages)).toEqual(["user:3", "answer:4->3"]);
  });

  it("resolves a leader answer inside the window that names a request from long before it", () => {
    const history = [
      leaderUser("u1", "Old request", 100),
      result(),
      leaderUser("u2", "Unrelated", 200),
      result(),
      leaderAnswer("Finally done.", 900, ["u1"]),
      result(),
    ];
    const threads = buildActivityStream({
      documents: [doc(history, { isOrchestrator: true })],
      since: 800,
      until: 1000,
    });
    expect(roles(threads[0]!.messages)).toEqual(["user:0", "answer:4->0"]);
  });

  it("lists the same messages from a saved activity record as from the history it was built from", () => {
    // Archived sessions are listed from their record; it must give the same result for any window.
    const history = [
      leaderUser("u1", "Fix the sidebar", 100, "q-5"),
      result(),
      leaderUser("u2", "Unrelated question", 200),
      leaderAnswer("Here is the answer.", 220, ["u2"]),
      result(),
      leaderAnswer("The sidebar is fixed.", 900, ["u1"]),
      result(),
      report("# Report", 950),
    ];
    const record = JSON.parse(JSON.stringify(buildSessionActivityRecord(history, true)));
    for (const [since, until] of [
      [0, 10_000],
      [800, 1000],
      [150, 250],
    ]) {
      const window = { since, until, textLimit: 10 };
      expect(
        buildActivityStream({ documents: [doc([], { isOrchestrator: true, activity: record })], ...window }),
      ).toEqual(buildActivityStream({ documents: [doc(history, { isOrchestrator: true })], ...window }));
    }
  });
});
