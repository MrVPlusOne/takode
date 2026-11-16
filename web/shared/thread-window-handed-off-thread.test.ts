import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import { buildThreadWindowSync } from "./thread-window.js";

/**
 * A thread that was handed off to a quest becomes the quest's thread: its address opens the quest,
 * and the handoff attaches the thread's messages to the quest. Messages routed to the thread after
 * that (another leader's `takode send --thread t-N`, sent once the handoff had happened) were
 * attached to nothing, so they showed in no view the user could open, while the leader's work on
 * them, routed to the quest, did. The server passes the quest's window the threads that became
 * part of it, and their messages read there.
 *
 * The history is shaped as a leader's stored history: the handoff's backfill refs and marker, a
 * peer leader's message with its `agentSource`, and the receiver's reply routed to the quest.
 */
const THREAD = "topic:5d1e7a20";
const QUEST = "q-40";
const PEER = { sessionId: "peer-leader", sessionLabel: "#7 Briefing Leader" };

function peerMessage(id: string, timestamp: number, threadKey: string, extra: Record<string, unknown> = {}) {
  const questId = threadKey.startsWith("q-") ? threadKey : undefined;
  return {
    type: "user_message",
    id,
    content: `message ${id}`,
    timestamp,
    agentSource: PEER,
    threadKey,
    ...(questId ? { questId } : {}),
    threadRefs: [{ threadKey, ...(questId ? { questId } : {}), source: "explicit", attachedAt: timestamp }],
    ...extra,
  } as unknown as BrowserIncomingMessage;
}

function reply(id: string, timestamp: number, threadKey: string, extra: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "text", text: `[thread:${threadKey}:C] reply ${id}` }],
      stop_reason: "end_turn",
    },
    parent_tool_use_id: null,
    timestamp,
    threadKey,
    ...(threadKey.startsWith("q-") ? { questId: threadKey } : {}),
    ...extra,
  } as unknown as BrowserIncomingMessage;
}

function result(timestamp: number) {
  return { type: "result", data: { is_error: false }, timestamp } as unknown as BrowserIncomingMessage;
}

/** The thread's own messages, attached to the quest by the handoff (backfill refs). */
const handedOff = { threadRefs: [{ threadKey: QUEST, questId: QUEST, source: "backfill", attachedAt: 30 }] };

const history: BrowserIncomingMessage[] = [
  reply("leader-in-thread", 10, THREAD, handedOff),
  result(11),
  {
    type: "thread_attachment_marker",
    id: "thread-handoff-30-2",
    markerKey: `handoff:${QUEST}`,
    timestamp: 30,
    sourceThreadKey: THREAD,
    threadKey: QUEST,
    questId: QUEST,
    attachedAt: 30,
    messageIds: ["leader-in-thread"],
    messageIndices: [0],
    ranges: ["0"],
    count: 1,
    firstMessageId: "leader-in-thread",
    firstMessageIndex: 0,
  } as unknown as BrowserIncomingMessage,
  // Sent with `--thread t-N` after the handoff: routed to the thread only.
  peerMessage("peer-after-handoff", 40, THREAD),
  reply("work-on-it", 41, QUEST),
  result(42),
  peerMessage("peer-to-quest", 50, QUEST),
];

function windowIds(threadKey: string, joinedThreads?: string[]): string[] {
  return buildThreadWindowSync({
    messageHistory: history,
    threadKey,
    joinedThreads,
    fromItem: -1,
    itemCount: 50,
    sectionItemCount: 50,
    visibleItemCount: 10,
  }).entries.flatMap((entry) => {
    const message = entry.message;
    if (message.type === "user_message") return [message.id ?? ""];
    if (message.type === "assistant") return [message.message.id];
    return [];
  });
}

describe("a thread handed off to a quest", () => {
  it("shows the messages still routed to the thread in the quest's thread, in time order", () => {
    expect(windowIds(QUEST, [THREAD])).toEqual([
      "leader-in-thread",
      "peer-after-handoff",
      "work-on-it",
      "peer-to-quest",
    ]);
  });

  it("left the later message out of the quest's thread when the server named no joined threads", () => {
    // What the quest's window held before: the reply to the message, but not the message.
    expect(windowIds(QUEST)).toEqual(["leader-in-thread", "work-on-it", "peer-to-quest"]);
  });

  it("keeps Main free of messages routed to the thread", () => {
    expect(windowIds("main")).not.toContain("peer-after-handoff");
  });
});
