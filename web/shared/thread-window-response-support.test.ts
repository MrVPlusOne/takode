import { describe, expect, it } from "vitest";
import type {
  BrowserIncomingMessage,
  LeaderThreadResponseProjection,
  LeaderThreadResponseRevisionMetadata,
} from "../server/session-types.js";
import { buildThreadWindowSync } from "./thread-window.js";

const THREAD_KEY = "q-2024";
const THREAD_REF = { threadKey: THREAD_KEY, questId: THREAD_KEY, source: "explicit" as const };

function human(id: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp,
    leaderResponseCoverageVersion: 1,
    threadKey: THREAD_KEY,
    questId: THREAD_KEY,
    threadRefs: [THREAD_REF],
  };
}

function revision(coveredUserMessageIds: string[]): LeaderThreadResponseRevisionMetadata {
  return {
    logicalResponseId: "logical-1",
    revisionId: "logical-1-r1",
    revisionNumber: 1,
    batchId: "batch-1",
    batchObservedHistoryLength: 2,
    coveredUserMessageIds,
    contentHash: "hash-1",
  };
}

function assistant(
  id: string,
  text: string,
  timestamp: number,
  role: "commentary" | "response",
  threadResponse?: LeaderThreadResponseRevisionMetadata,
): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: role,
    threadKey: THREAD_KEY,
    questId: THREAD_KEY,
    threadRefs: [THREAD_REF],
    ...(threadResponse ? { threadResponse } : {}),
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

function projection(ready: boolean): LeaderThreadResponseProjection {
  return {
    version: 1,
    threadKey: THREAD_KEY,
    cutoverHistoryIndex: 0,
    pendingMessageCount: ready ? 0 : 1,
    pendingBatches: ready
      ? []
      : [
          {
            userMessageIds: ["u2"],
            messageCount: 1,
            firstHistoryIndex: 3,
            lastHistoryIndex: 3,
            firstAskedAt: 4,
            lastAskedAt: 4,
          },
        ],
    currentResponses: [
      {
        version: 1,
        logicalResponseId: "logical-1",
        threadKey: THREAD_KEY,
        questId: THREAD_KEY,
        batchId: "batch-1",
        batchObservedHistoryLength: 2,
        coveredUserMessageIds: ["u1"],
        currentRevisionId: "logical-1-r1",
        currentMessageId: "response-1",
        currentHistoryIndex: 1,
        revisionCount: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    ready,
  };
}

function deliveredIds(sync: ReturnType<typeof buildThreadWindowSync>): string[] {
  return sync.entries.flatMap(({ message }) => {
    if (message.type === "assistant") return [message.message.id];
    if (message.type === "user_message" || message.type === "leader_user_message")
      return message.id ? [message.id] : [];
    return [];
  });
}

describe("selected thread-window routed final-response support", () => {
  it("backfills an ordinary assistant final and its prompt anchor while newer input is pending", () => {
    // The latest bounded range starts at u2. Expanded history still needs the
    // prior current final and u1 anchor to prove and render current identity.
    const messages: BrowserIncomingMessage[] = [
      human("u1", 1),
      assistant("response-1", "Current final", 2, "response", revision(["u1"])),
      assistant("quiz", "{[(Quest Quiz: q-2024)]}", 3, "commentary"),
      human("u2", 4),
      assistant("commentary", "Working on the follow-up", 5, "commentary"),
    ];

    const sync = buildThreadWindowSync({
      messageHistory: messages,
      threadKey: THREAD_KEY,
      fromItem: -1,
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
      currentThreadResponseProjection: projection(false),
    });

    expect(sync.threadResponseSupportComplete).toBe(true);
    expect(deliveredIds(sync)).toEqual(expect.arrayContaining(["u1", "response-1", "u2", "commentary"]));
    expect(deliveredIds(sync)).not.toContain("quiz");
  });

  it("fails closed when response authority points at commentary instead of an assistant final", () => {
    const messages: BrowserIncomingMessage[] = [
      human("u1", 1),
      assistant("response-1", "Not actually final", 2, "commentary", revision(["u1"])),
    ];

    const sync = buildThreadWindowSync({
      messageHistory: messages,
      threadKey: THREAD_KEY,
      fromItem: -1,
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
      currentThreadResponseProjection: projection(true),
    });

    expect(sync.threadResponseSupportComplete).toBe(false);
  });

  it("continues to support legacy dedicated response rows during bounded-window replay", () => {
    const legacy: BrowserIncomingMessage = {
      type: "leader_user_message",
      id: "response-1",
      content: "Legacy current final",
      timestamp: 2,
      threadKey: THREAD_KEY,
      questId: THREAD_KEY,
      threadRefs: [THREAD_REF],
      threadResponse: revision(["u1"]),
    };
    const sync = buildThreadWindowSync({
      messageHistory: [human("u1", 1), legacy, human("u2", 3)],
      threadKey: THREAD_KEY,
      fromItem: -1,
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
      currentThreadResponseProjection: projection(false),
    });

    expect(sync.threadResponseSupportComplete).toBe(true);
    expect(deliveredIds(sync)).toEqual(expect.arrayContaining(["u1", "response-1", "u2"]));
  });
});
