import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
  leaderThreadResponseContentHash,
} from "./leader-thread-response.js";

function session() {
  return { id: "leader-1", messageHistory: [] as BrowserIncomingMessage[] };
}

function human(userMessageId: string, timestamp: number, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: `raw-${userMessageId}`,
    leaderUserMessageId: userMessageId,
    content: `Ask ${userMessageId}`,
    timestamp,
    threadKey,
    leaderResponseCoverageVersion: 1,
    ...(threadKey === "main"
      ? {}
      : {
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit", attachedAt: timestamp }],
        }),
  };
}

function routedAssistant(
  id: string,
  text: string,
  answerUserMessageIds: string[] | undefined,
  observedHistoryLength: number | undefined,
  threadKey = "main",
  role: "commentary" | "answer" = "answer",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 100,
    threadKey,
    leaderThreadRole: role,
    ...(answerUserMessageIds ? { leaderAnswerUserMessageIds: answerUserMessageIds } : {}),
    ...(observedHistoryLength === undefined ? {} : { leaderAnswerObservedHistoryLength: observedHistoryLength }),
    ...(threadKey === "main"
      ? {}
      : {
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit", attachedAt: 100 }],
        }),
  };
}

function appendAnswer(
  target: ReturnType<typeof session>,
  id: string,
  answerUserMessageIds: string[],
  text: string,
  observedHistoryLength: number,
  threadKey = "main",
) {
  const message = routedAssistant(id, text, answerUserMessageIds, observedHistoryLength, threadKey);
  target.messageHistory.push(message);
  expect(finalizeRoutedLeaderResponseMessage(target, message)).toEqual({ finalized: true, answerId: id });
  return message;
}

function legacyBatchId(sessionId: string, threadKey: string, historyLength: number, ids: string[]): string {
  const encoded = Buffer.from(JSON.stringify({ v: 1, t: threadKey, h: historyLength, ids })).toString("base64url");
  const checksum = createHash("sha256").update(`${sessionId}\n${encoded}`).digest("hex").slice(0, 24);
  return `response-batch-v1.${encoded}.${checksum}`;
}

function legacyResponse(
  target: ReturnType<typeof session>,
  id: string,
  text: string,
  coveredIds: string[],
  observedHistoryLength: number,
  threadKey = "main",
): Extract<BrowserIncomingMessage, { type: "leader_user_message" }> {
  const logicalResponseId = `legacy-${id}`;
  const message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }> = {
    type: "leader_user_message",
    id,
    content: text,
    timestamp: 50,
    threadKey,
    ...(threadKey === "main"
      ? {}
      : { questId: threadKey, threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }] }),
    threadResponse: {
      logicalResponseId,
      revisionId: `${logicalResponseId}-r1`,
      revisionNumber: 1,
      batchId: legacyBatchId(target.id, threadKey, observedHistoryLength, coveredIds),
      batchObservedHistoryLength: observedHistoryLength,
      coveredUserMessageIds: coveredIds,
      contentHash: leaderThreadResponseContentHash(text),
    },
  };
  target.messageHistory.push(message);
  return message;
}

describe("explicit routed leader answers", () => {
  it("ignores pre-cutover history and projects concise pending IDs", () => {
    const target = session();
    target.messageHistory.push(
      { type: "user_message", id: "legacy", content: "Old ask", timestamp: 1, threadKey: "main" },
      human("u1", 2),
      human("u2", 3),
    );

    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      version: 2,
      cutoverHistoryIndex: 1,
      pendingMessageCount: 2,
      pendingMessages: [
        { userMessageId: "u1", historyMessageId: "raw-u1", historyIndex: 1 },
        { userMessageId: "u2", historyMessageId: "raw-u2", historyIndex: 2 },
      ],
      currentAnswers: [],
      ready: false,
    });
  });

  it("answers a later clarification while older work remains pending, then reaches Ready asynchronously", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    appendAnswer(target, "answer-u2", ["u2"], "Clarification answered.", 2);

    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 1,
      pendingMessages: [{ userMessageId: "u1" }],
      currentAnswers: [
        {
          currentMessageId: "answer-u2",
          answerUserMessageIds: ["u2"],
          coveredAnswerUserMessageIds: ["u2"],
        },
      ],
      ready: false,
    });

    appendAnswer(target, "answer-u1", ["u1"], "Earlier implementation complete.", 3);
    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 0,
      currentAnswers: [
        { currentMessageId: "answer-u2", coveredAnswerUserMessageIds: ["u2"] },
        { currentMessageId: "answer-u1", coveredAnswerUserMessageIds: ["u1"] },
      ],
      ready: true,
    });
  });

  it("allows one answer to cover consecutive messages", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    const answer = appendAnswer(target, "answer-both", ["u1", "u2"], "Combined answer.", 2);

    expect(answer.threadAnswer).toEqual({ version: 2, answerUserMessageIds: ["u1", "u2"], observedHistoryLength: 2 });
    expect(buildLeaderThreadResponseState(target, "main").responses[0]).toMatchObject({
      answerUserMessageIds: ["u1", "u2"],
      referencedUserMessageIds: ["raw-u1", "raw-u2"],
      coveredAnswerUserMessageIds: ["u1", "u2"],
      coveredUserMessageIds: ["raw-u1", "raw-u2"],
    });
  });

  it("supersedes only the repeated IDs while retaining append-only answer history", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1), human("u2", 2));
    appendAnswer(target, "answer-both", ["u1", "u2"], "First combined answer.", 2);
    appendAnswer(target, "answer-u2-new", ["u2"], "Updated second answer.", 3);

    expect(buildLeaderThreadResponseState(target, "main").responses).toMatchObject([
      {
        currentMessageId: "answer-both",
        answerUserMessageIds: ["u1", "u2"],
        coveredAnswerUserMessageIds: ["u1"],
      },
      {
        currentMessageId: "answer-u2-new",
        answerUserMessageIds: ["u2"],
        coveredAnswerUserMessageIds: ["u2"],
      },
    ]);
  });

  it("rejects unknown, unseen, cross-thread, duplicate, and out-of-order IDs atomically", () => {
    const cases: Array<{ ids: string[]; observed: number; thread?: string }> = [
      { ids: ["u9"], observed: 2 },
      { ids: ["u2"], observed: 1 },
      { ids: ["u1", "u1"], observed: 2 },
      { ids: ["u2", "u1"], observed: 2 },
      { ids: ["u1", "u3"], observed: 3 },
      { ids: ["u2"], observed: 3, thread: "q-42" },
    ];
    for (const [index, testCase] of cases.entries()) {
      const target = session();
      target.messageHistory.push(human("u1", 1), human("u2", 2), human("u3", 3));
      const answer = routedAssistant(
        `invalid-${index}`,
        "Invalid answer.",
        testCase.ids,
        testCase.observed,
        testCase.thread ?? "main",
      );
      target.messageHistory.push(answer);
      expect(finalizeRoutedLeaderResponseMessage(target, answer)).toMatchObject({
        finalized: false,
        reason: "invalid_message",
      });
      expect(answer.threadAnswer).toBeUndefined();
    }
  });

  it("recomputes current ownership from the newest authoritative non-backfill reference", () => {
    const target = session();
    const moved = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    moved.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "explicit", attachedAt: 2 }];
    target.messageHistory.push(moved);

    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(0);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.pendingMessages).toMatchObject([
      { userMessageId: "u1" },
    ]);

    const wrongThread = routedAssistant("wrong", "Wrong-thread answer.", ["u1"], 1);
    target.messageHistory.push(wrongThread);
    expect(finalizeRoutedLeaderResponseMessage(target, wrongThread)).toMatchObject({ reason: "invalid_message" });

    appendAnswer(target, "moved-answer", ["u1"], "Quest-thread answer.", 1, "q-42");
    expect(buildLeaderThreadResponseState(target, "q-42").projection.ready).toBe(true);
  });

  it("keeps a current answer valid when the answer row gains visibility-only backfill refs", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1, "q-42"));
    const answer = appendAnswer(target, "answer-q42", ["u1"], "Quest answer.", 1, "q-42");
    answer.threadRefs = [
      ...(answer.threadRefs ?? []),
      { threadKey: "q-99", questId: "q-99", source: "backfill", attachedAt: 200 },
    ];

    expect(buildLeaderThreadResponseState(target, "q-42").projection.ready).toBe(true);
    expect(buildLeaderThreadResponseState(target, "q-42").responses[0]?.currentMessageId).toBe("answer-q42");
  });

  it("keeps backfill visibility separate from answer ownership", () => {
    const target = session();
    const attached = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    attached.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(attached);

    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessages).toMatchObject([
      { userMessageId: "u1" },
    ]);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.pendingMessageCount).toBe(0);
  });

  it("projects the exact Main-owned u25 answer identity into its q-2024 backfill association", () => {
    const target = session();
    const request = human("u25", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    request.threadRefs = [{ threadKey: "q-2024", questId: "q-2024", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(request);
    appendAnswer(target, "answer-u25", ["u25"], "Main answer for the attached request.", 1);

    const main = buildLeaderThreadResponseState(target, "main").projection;
    const quest = buildLeaderThreadResponseState(target, "q-2024").projection;
    expect(main).toMatchObject({
      threadKey: "main",
      cutoverHistoryIndex: 0,
      pendingMessageCount: 0,
      ready: true,
      currentAnswers: [
        {
          threadKey: "main",
          answerUserMessageIds: ["u25"],
          referencedUserMessageIds: ["raw-u25"],
          coveredAnswerUserMessageIds: ["u25"],
          coveredUserMessageIds: ["raw-u25"],
          currentMessageId: "answer-u25",
          currentHistoryIndex: 1,
          source: "explicit",
        },
      ],
    });
    expect(quest).toMatchObject({
      threadKey: "q-2024",
      cutoverHistoryIndex: 0,
      pendingMessageCount: 0,
      ready: true,
      currentAnswers: [
        {
          threadKey: "main",
          answerUserMessageIds: ["u25"],
          referencedUserMessageIds: ["raw-u25"],
          coveredAnswerUserMessageIds: ["u25"],
          coveredUserMessageIds: ["raw-u25"],
          currentMessageId: "answer-u25",
          currentHistoryIndex: 1,
          source: "explicit",
        },
      ],
    });
    expect(quest.currentAnswers[0]?.currentMessageId).toBe(main.currentAnswers[0]?.currentMessageId);
    expect(quest.currentAnswers[0]?.currentHistoryIndex).toBe(main.currentAnswers[0]?.currentHistoryIndex);
    expect(buildLeaderThreadResponseState(target, "q-999").projection.currentAnswers).toEqual([]);

    request.threadRefs = [];
    expect(buildLeaderThreadResponseState(target, "q-2024").projection.currentAnswers).toEqual([]);

    request.threadRefs = [
      { threadKey: "q-2024", questId: "q-2024", source: "backfill", attachedAt: 2 },
      { threadKey: "q-2030", questId: "q-2030", source: "explicit", attachedAt: 3 },
    ];
    expect(buildLeaderThreadResponseState(target, "main").projection.currentAnswers).toEqual([]);
    expect(buildLeaderThreadResponseState(target, "q-2024").projection.currentAnswers).toEqual([]);
    expect(buildLeaderThreadResponseState(target, "q-2030").projection).toMatchObject({
      pendingMessages: [{ userMessageId: "u25" }],
      currentAnswers: [],
      ready: false,
    });
  });

  it("projects one Main answer across multiple current quest associations independently", () => {
    const target = session();
    const request = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    request.threadRefs = [
      { threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 2 },
      { threadKey: "q-43", questId: "q-43", source: "backfill", attachedAt: 3 },
    ];
    target.messageHistory.push(request);
    appendAnswer(target, "multi-associated-answer", ["u1"], "One Main answer.", 1);

    const identity = {
      threadKey: "main",
      currentMessageId: "multi-associated-answer",
      currentHistoryIndex: 1,
      source: "explicit",
    } as const;
    const mainBefore = buildLeaderThreadResponseState(target, "main").projection;
    const q42Before = buildLeaderThreadResponseState(target, "q-42").projection;
    const q43Before = buildLeaderThreadResponseState(target, "q-43").projection;

    expect(mainBefore.currentAnswers).toMatchObject([identity]);
    expect(q42Before.currentAnswers).toMatchObject([identity]);
    expect(q43Before.currentAnswers).toMatchObject([identity]);
    expect(buildLeaderThreadResponseState(target, "q-44").projection.currentAnswers).toEqual([]);

    request.threadRefs = request.threadRefs.filter((ref) => ref.threadKey !== "q-42");

    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toEqual([]);
    expect(buildLeaderThreadResponseState(target, "main").projection).toEqual(mainBefore);
    expect(buildLeaderThreadResponseState(target, "q-43").projection).toEqual(q43Before);
  });

  it("fails grouped cross-thread projection unless every original answer reference is associated", () => {
    const target = session();
    const first = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    const second = human("u2", 2) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    first.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 3 }];
    target.messageHistory.push(first, second);
    appendAnswer(target, "main-answer", ["u1", "u2"], "Indivisible grouped Main answer.", 2);

    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toEqual([]);

    second.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 4 }];
    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toMatchObject([
      {
        threadKey: "main",
        answerUserMessageIds: ["u1", "u2"],
        referencedUserMessageIds: ["raw-u1", "raw-u2"],
        coveredAnswerUserMessageIds: ["u1", "u2"],
        coveredUserMessageIds: ["raw-u1", "raw-u2"],
        currentMessageId: "main-answer",
      },
    ]);

    appendAnswer(target, "main-answer-u2", ["u2"], "Updated second answer.", 3);
    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toMatchObject([
      { currentMessageId: "main-answer", coveredAnswerUserMessageIds: ["u1"] },
      { currentMessageId: "main-answer-u2", coveredAnswerUserMessageIds: ["u2"] },
    ]);
  });

  it("does not treat a persisted Main backfill as association for a quest-owned answer", () => {
    const target = session();
    const request = human("u1", 1, "q-42") as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    request.threadRefs = [...(request.threadRefs ?? []), { threadKey: "main", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(request);
    appendAnswer(target, "quest-answer", ["u1"], "Quest-owned answer.", 1, "q-42");

    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toMatchObject([
      { threadKey: "q-42", currentMessageId: "quest-answer" },
    ]);
    expect(buildLeaderThreadResponseState(target, "main").projection.currentAnswers).toEqual([]);
  });

  it("cross-projects deterministic fallback IDs without rewriting the source user message", () => {
    const target = session();
    const request = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    request.leaderUserMessageId = undefined;
    request.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 2 }];
    target.messageHistory.push(request);
    appendAnswer(target, "fallback-id-answer", ["u1"], "Answer using the deterministic ID.", 1);

    expect(request.leaderUserMessageId).toBeUndefined();
    expect(buildLeaderThreadResponseState(target, "q-42").projection).toMatchObject({
      cutoverHistoryIndex: 0,
      currentAnswers: [
        {
          threadKey: "main",
          answerUserMessageIds: ["u1"],
          referencedUserMessageIds: ["raw-u1"],
          coveredAnswerUserMessageIds: ["u1"],
          coveredUserMessageIds: ["raw-u1"],
          currentMessageId: "fallback-id-answer",
        },
      ],
    });
  });

  it("does not let commentary satisfy answer coverage", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const commentary = routedAssistant("commentary", "Still working.", undefined, undefined, "main", "commentary");
    target.messageHistory.push(commentary);

    expect(finalizeRoutedLeaderResponseMessage(target, commentary)).toEqual({
      finalized: false,
      reason: "not_answer",
    });
    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 1,
      ready: false,
      currentAnswers: [],
    });
  });

  it("rejects malformed Main and quest answer-source routes before they can project", () => {
    const mainTarget = session();
    mainTarget.messageHistory.push(human("u1", 1));
    const malformedMain = routedAssistant("malformed-main", "Malformed Main answer.", ["u1"], 1);
    malformedMain.questId = "q-42";
    mainTarget.messageHistory.push(malformedMain);
    expect(finalizeRoutedLeaderResponseMessage(mainTarget, malformedMain)).toMatchObject({ reason: "invalid_message" });
    expect(buildLeaderThreadResponseState(mainTarget, "main").projection.currentAnswers).toEqual([]);

    const questTarget = session();
    questTarget.messageHistory.push(human("u1", 1, "q-42"));
    const malformedQuest = routedAssistant("malformed-quest", "Malformed quest answer.", ["u1"], 1, "q-42");
    malformedQuest.questId = "q-99";
    questTarget.messageHistory.push(malformedQuest);
    expect(finalizeRoutedLeaderResponseMessage(questTarget, malformedQuest)).toMatchObject({
      reason: "invalid_message",
    });
    expect(buildLeaderThreadResponseState(questTarget, "q-42").projection.currentAnswers).toEqual([]);
  });

  it("fails closed on unproven, tool-bearing, conflicting-control, child, or detached answer rows", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));

    const unproven = routedAssistant("unproven", "Answer.", ["u1"], undefined);
    target.messageHistory.push(unproven);
    expect(finalizeRoutedLeaderResponseMessage(target, unproven)).toMatchObject({ reason: "unproven_observation" });

    const toolBearing = routedAssistant("tool-bearing", "Answer.", ["u1"], 1);
    toolBearing.message.content.push({ type: "tool_use", id: "tool", name: "Bash", input: { command: "true" } });
    target.messageHistory.push(toolBearing);
    expect(finalizeRoutedLeaderResponseMessage(target, toolBearing)).toMatchObject({ reason: "invalid_message" });

    const conflicting = routedAssistant("conflicting", "[thread:main:C] Conflicting role.", ["u1"], 1);
    target.messageHistory.push(conflicting);
    expect(finalizeRoutedLeaderResponseMessage(target, conflicting)).toMatchObject({ reason: "invalid_message" });

    const child = routedAssistant("child", "Child answer.", ["u1"], 1);
    child.codexSubagent = { childId: "opaque-child", rootTurnId: "root-turn" };
    target.messageHistory.push(child);
    expect(finalizeRoutedLeaderResponseMessage(target, child)).toMatchObject({ reason: "invalid_message" });

    const detached = routedAssistant("detached", "Detached answer.", ["u1"], 1);
    expect(finalizeRoutedLeaderResponseMessage(target, detached)).toMatchObject({ reason: "invalid_message" });
    expect(buildLeaderThreadResponseState(target, "main").projection.pendingMessageCount).toBe(1);
  });

  it("rejects a Quiz-only answer while allowing a Quiz beside substantive prose", () => {
    // Hidden Quiz directives cannot become answer proof by contributing their letters and digits.
    const target = session();
    target.messageHistory.push(human("u1", 1, "q-42"));

    const quizOnly = routedAssistant("quiz-only", "{[(Quest Quiz: q-42)]}", ["u1"], 1, "q-42");
    target.messageHistory.push(quizOnly);
    expect(finalizeRoutedLeaderResponseMessage(target, quizOnly)).toMatchObject({ reason: "invalid_message" });
    expect(buildLeaderThreadResponseState(target, "q-42").projection.pendingMessageCount).toBe(1);

    const answered = routedAssistant(
      "answer-with-quiz",
      "The requested implementation is complete.\n{[(Quest Quiz: q-42)]}",
      ["u1"],
      1,
      "q-42",
    );
    target.messageHistory.push(answered);
    expect(finalizeRoutedLeaderResponseMessage(target, answered)).toMatchObject({ finalized: true });
  });

  it("rejects unfenced control directives while allowing fenced examples", () => {
    for (const [id, text] of [
      ["answer-marker", "Answer.\n[thread:q-2:A:u1]\nMisrouted continuation."],
      ["missing-role", "Answer.\n[thread:q-2]\nMissing role."],
      ["invalid-role", "Answer.\n[thread:q-2:F]\nInvalid role."],
      ["unknown-target", "Answer.\n[thread:side:A:u1]\nUnknown target."],
    ] as const) {
      const target = session();
      target.messageHistory.push(human("u1", 1));
      const answer = routedAssistant(id, text, ["u1"], 1);
      target.messageHistory.push(answer);
      expect(finalizeRoutedLeaderResponseMessage(target, answer)).toMatchObject({
        finalized: false,
        reason: "invalid_message",
      });
    }

    const fencedTarget = session();
    fencedTarget.messageHistory.push(human("u1", 1));
    const fenced = routedAssistant("fenced-example", "Example:\n```text\n[thread:q-2:F]\n```", ["u1"], 1);
    fencedTarget.messageHistory.push(fenced);
    expect(finalizeRoutedLeaderResponseMessage(fencedTarget, fenced)).toMatchObject({ finalized: true });
  });

  it("is idempotent and rejects a reused answer message ID", () => {
    const target = session();
    target.messageHistory.push(human("u1", 1));
    const answer = appendAnswer(target, "stable-answer", ["u1"], "Stable answer.", 1);

    expect(finalizeRoutedLeaderResponseMessage(target, answer)).toEqual({
      finalized: false,
      reason: "already_finalized",
    });
    const duplicate = routedAssistant("stable-answer", "Duplicate ID.", ["u1"], 1);
    target.messageHistory.push(duplicate);
    expect(finalizeRoutedLeaderResponseMessage(target, duplicate)).toMatchObject({ reason: "invalid_message" });
  });

  it("keeps valid legacy response rows source-local and rejects corrupted legacy proof", () => {
    const target = session();
    const first = human("u1", 1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    const second = human("u2", 2) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    first.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 3 }];
    second.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "backfill", attachedAt: 4 }];
    target.messageHistory.push(first, second);
    const response = legacyResponse(target, "legacy-final", "Legacy answer.", ["raw-u1", "raw-u2"], 2);

    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 0,
      ready: true,
      currentAnswers: [
        {
          currentMessageId: "legacy-final",
          answerUserMessageIds: ["u1", "u2"],
          coveredAnswerUserMessageIds: ["u1", "u2"],
          source: "legacy",
        },
      ],
    });
    expect(buildLeaderThreadResponseState(target, "q-42").projection.currentAnswers).toEqual([]);

    response.content = "Tampered response.";
    expect(buildLeaderThreadResponseState(target, "main").projection).toMatchObject({
      pendingMessageCount: 2,
      ready: false,
      currentAnswers: [],
    });
  });
});
