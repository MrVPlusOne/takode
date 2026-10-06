import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { leaderResponseProvenCurrentOwnerThreadKey } from "../shared/leader-thread-response-routing.js";
import { handoffThreadRef } from "./leader-thread-handoff.js";
import { buildLeaderThreadResponseState, finalizeRoutedLeaderResponseMessage } from "./leader-thread-response.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BrowserIncomingMessage, ThreadAttachmentMarker } from "./session-types.js";

type Assistant = Extract<BrowserIncomingMessage, { type: "assistant" }>;

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "session-history-edits-"));
  roots.push(root);
  return root;
}

function assistant(id: string, text: string, fields: Partial<Assistant> = {}): Assistant {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    timestamp: 10,
    threadKey: "main",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    ...fields,
  };
}

function result(): BrowserIncomingMessage {
  return { type: "result", data: { type: "result", subtype: "success" } } as BrowserIncomingMessage;
}

/** A leader whose first request's turn has completed, so the request is in the frozen log. */
function leaderWithCompletedRequest(): PersistedSession {
  return {
    id: "leader",
    state: { session_id: "leader" } as PersistedSession["state"],
    messageHistory: [
      {
        type: "user_message",
        id: "raw-u1",
        content: "Trim the permission menu",
        timestamp: 1,
        threadKey: "main",
        leaderUserMessageId: "u1",
        leaderResponseCoverageVersion: 1,
      },
      assistant("ack", "[thread:main:C]\nFiling a quest."),
      result(),
    ],
    pendingMessages: [],
    pendingPermissions: [],
  };
}

/** Apply the in-memory effect of `takode thread handoff` for u1 to q-42. */
function handOffFirstRequest(session: PersistedSession): void {
  const request = session.messageHistory[0];
  if (request?.type !== "user_message") throw new Error("fixture request missing");
  request.threadRefs = [handoffThreadRef("q-42", 50, "leader")];
  const marker: ThreadAttachmentMarker = {
    type: "thread_attachment_marker",
    id: "thread-handoff-50-3",
    markerKey: "handoff:thread-attachment:q-42:raw-u1",
    timestamp: 50,
    sourceThreadKey: "main",
    threadKey: "q-42",
    questId: "q-42",
    attachedAt: 50,
    attachedBy: "leader",
    messageIds: ["raw-u1"],
    messageIndices: [0],
    ranges: ["0"],
    count: 1,
  };
  session.messageHistory.push(marker);
}

/** The leader later answers u1 in the quest thread and the turn completes. */
function answerInQuest(session: PersistedSession): void {
  const answer = assistant("quest-answer", "The permission menu now lists only the essential modes.", {
    threadKey: "q-42",
    questId: "q-42",
    threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
    leaderThreadRole: "answer",
    leaderAnswerUserMessageIds: ["u1"],
    leaderAnswerObservedHistoryLength: session.messageHistory.length,
  });
  session.messageHistory.push(answer);
  expect(finalizeRoutedLeaderResponseMessage(session, answer).finalized).toBe(true);
  session.messageHistory.push(result());
}

function pending(session: PersistedSession, threadKey: string): string[] {
  return buildLeaderThreadResponseState(session, threadKey).projection.pendingMessages.map((row) => row.userMessageId);
}

it("keeps a handoff of an already-frozen request and its quest answer across restart", async () => {
  // Regression: the frozen log is append-only, so a handoff that edited an
  // already-frozen request was lost on restart. The request returned to Main
  // and its quest answer stopped counting, leaving it pending in Main.
  const root = await tempRoot();
  const store = new SessionStore(root);
  const session = leaderWithCompletedRequest();
  await store.saveSync(session);

  handOffFirstRequest(session);
  await store.saveHistoryEdits(session, [0]);
  answerInQuest(session);
  await store.saveSync(session);
  await store.flushAll();
  // Written directly, not recovered by the restore-time repair for older logs.
  const log = await readFile(join(root, `${session.id}.history.jsonl`), "utf-8");
  expect(JSON.parse(log.split("\n")[1]!)).toMatchObject({ threadRefs: [handoffThreadRef("q-42", 50, "leader")] });

  vi.spyOn(console, "warn");
  const restored = (await new SessionStore(root).load(session.id))!;
  expect(console.warn).not.toHaveBeenCalled();
  expect(restored._frozenCount).toBe(restored.messageHistory.length);
  expect(leaderResponseProvenCurrentOwnerThreadKey(restored.messageHistory[0] as never)).toBe("q-42");
  expect(pending(restored, "main")).toEqual([]);
  expect(pending(restored, "q-42")).toEqual([]);
});

it("restores handoffs that an older server never persisted, and persists the repair", async () => {
  // Older servers saved the handoff with an ordinary save, which never rewrote
  // the frozen request. The appended handoff marker still records the transfer.
  const root = await tempRoot();
  const store = new SessionStore(root);
  const session = leaderWithCompletedRequest();
  await store.saveSync(session);
  handOffFirstRequest(session);
  await store.saveSync(session);
  answerInQuest(session);
  await store.saveSync(session);
  await store.flushAll();
  const frozenLog = join(root, `${session.id}.history.jsonl`);
  const frozenRequest = () => readFile(frozenLog, "utf-8").then((log) => JSON.parse(log.split("\n")[1]!));
  expect(await frozenRequest()).not.toHaveProperty("threadRefs");

  vi.spyOn(console, "warn").mockImplementation(() => {});
  const restoringStore = new SessionStore(root);
  const restored = (await restoringStore.load(session.id))!;
  await restoringStore.flushAll();
  expect(restored.messageHistory[0]).toMatchObject({ threadRefs: [handoffThreadRef("q-42", 50, "leader")] });
  expect(pending(restored, "main")).toEqual([]);
  expect(pending(restored, "q-42")).toEqual([]);

  // The repair is written back, so later restarts read the ref directly.
  expect(await frozenRequest()).toHaveProperty("threadRefs");
  const reloaded = (await new SessionStore(root).load(session.id))!;
  expect(reloaded.messageHistory).toEqual(restored.messageHistory);
  expect(console.warn).toHaveBeenCalledTimes(1);
});

/** Push the fixture past the large-history threshold so it saves in the chunked history format. */
function makeLarge(session: PersistedSession): void {
  const ack = session.messageHistory[1] as Assistant;
  ack.message.content = [{ type: "text", text: `[thread:main:C]\nFiling a quest.\n${"x".repeat(600_000)}` }];
}

async function hasHistoryRef(root: string, sessionId: string): Promise<boolean> {
  return Object.hasOwn(JSON.parse(await readFile(join(root, `${sessionId}.json`), "utf-8")), "_historyRef");
}

it("keeps a handoff of an already-frozen request in a large chunked-format history across restart", async () => {
  // Large histories use the chunked history format instead of the frozen log.
  // Its rows are content-addressed, so a handoff edit to a frozen row must
  // still publish a replacement row rather than being skipped.
  const root = await tempRoot();
  const store = new SessionStore(root);
  const session = leaderWithCompletedRequest();
  makeLarge(session);
  await store.saveSync(session);
  expect(await hasHistoryRef(root, session.id)).toBe(true);

  handOffFirstRequest(session);
  await store.saveHistoryEdits(session, [0]);
  answerInQuest(session);
  await store.saveSync(session);
  await store.flushAll();

  vi.spyOn(console, "warn");
  const restored = (await new SessionStore(root).load(session.id))!;
  // No warning: the ref was written directly, not recovered by the restore-time repair.
  expect(console.warn).not.toHaveBeenCalled();
  expect(restored.messageHistory).toEqual(session.messageHistory);
  expect(leaderResponseProvenCurrentOwnerThreadKey(restored.messageHistory[0] as never)).toBe("q-42");
  expect(pending(restored, "main")).toEqual([]);
  expect(pending(restored, "q-42")).toEqual([]);
});

it("restores unpersisted handoffs in a chunked-format history, such as offline-converted data, and persists the repair", async () => {
  // The offline converter can produce chunked histories from a branch that
  // never persisted handoff edits. Restore must apply the same marker-based
  // repair as the frozen-log path.
  const root = await tempRoot();
  const store = new SessionStore(root);
  const session = leaderWithCompletedRequest();
  makeLarge(session);
  handOffFirstRequest(session);
  answerInQuest(session);
  const saved = structuredClone(session);
  delete (saved.messageHistory[0] as { threadRefs?: unknown }).threadRefs;
  await store.saveSync(saved);
  await store.flushAll();
  expect(await hasHistoryRef(root, session.id)).toBe(true);

  vi.spyOn(console, "warn").mockImplementation(() => {});
  const restoringStore = new SessionStore(root);
  const restored = (await restoringStore.load(session.id))!;
  await restoringStore.flushAll();
  expect(restored.messageHistory[0]).toMatchObject({ threadRefs: [handoffThreadRef("q-42", 50, "leader")] });
  expect(pending(restored, "main")).toEqual([]);
  expect(pending(restored, "q-42")).toEqual([]);

  // The repair is written back, so the next restart reads the ref without repairing again.
  const reloaded = (await new SessionStore(root).load(session.id))!;
  expect(reloaded.messageHistory).toEqual(restored.messageHistory);
  expect(console.warn).toHaveBeenCalledTimes(1);
});
