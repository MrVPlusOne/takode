import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_PLACEHOLDER_LANGUAGE } from "../../shared/artifact-library.js";
import { groupDraftPostsInMarkdown, parseGroupedDraftPost } from "../../shared/draft-posts.js";
import { ArtifactLibraryStore } from "../artifact-library-store.js";
import { ArtifactLibrary } from "../artifact-library.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { RouteContext } from "./context.js";
import { createSharedDraftRoutes } from "./shared-drafts.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

let counter = 0;
function assistant(text: string): BrowserIncomingMessage {
  counter += 1;
  return {
    type: "assistant",
    message: {
      id: `msg-${counter}`,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: Date.now() + counter,
  } as BrowserIncomingMessage;
}

const FIRST = [
  "Here is the update.",
  "```draft\ntitle: Slack update\nto: https://example.slack.com/archives/C1/p1\n---\nT7 evals start today.\nattach: /tmp/plot.png\n```",
  "```draft\nFirst reply\n```",
].join("\n\n");
const REVISION = "Only the reply changed.\n\n```draft\ntitle: Slack update\npart: 2\n---\nFirst reply, revised\n```";

/**
 * Sharing a worker's draft into a leader's thread over a real Library on disposable state: a leader
 * ("leader"), a worker it herds and a worker it doesn't. Requests act as the session named by the
 * x-caller header; the leader's saves feed the Library as session saves do in the server.
 */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "shared-drafts-"));
  roots.push(root);
  const sessions = new Map(
    ["leader", "worker", "stranger"].map((id) => [
      id,
      { id, messageHistory: [] as BrowserIncomingMessage[], state: {}, notifications: [] as unknown[] },
    ]),
  );
  const info: Record<string, { isOrchestrator: boolean; sessionNum: number; herdedBy?: string }> = {
    leader: { isOrchestrator: true, sessionNum: 1 },
    worker: { isOrchestrator: false, sessionNum: 7, herdedBy: "leader" },
    stranger: { isOrchestrator: false, sessionNum: 9, herdedBy: "other-leader" },
  };
  const store = new ArtifactLibraryStore(root);
  await store.load();
  const library = new ArtifactLibrary(store, {
    getSession: (id) => sessions.get(id),
    listSessions: () => [...sessions.values()],
    spaceFor: () => "Takode",
    refreshConversation: vi.fn(),
  });
  const ctx = {
    authenticateTakodeCaller: (c: any) => {
      const callerId = c.req.header("x-caller") ?? "leader";
      return { callerId, caller: { sessionId: callerId, archived: false } };
    },
    resolveId: (id: string) => (sessions.has(id) ? id : null),
    launcher: { getSession: (id: string) => info[id] },
    wsBridge: {
      getSession: (id: string) => sessions.get(id) ?? null,
      persistSessionById: (id: string) => library.sessionSaved(id),
      broadcastToSession: vi.fn(),
      refreshSessionConversation: vi.fn(),
      getSessionNotificationDeps: () => ({
        broadcastToBrowsers: vi.fn(),
        persistSession: vi.fn(),
        promoteLeaderThreadTabForAttention: vi.fn(),
      }),
    },
  } as unknown as RouteContext;
  const api = createSharedDraftRoutes(ctx, () => library);
  const share = (body: Record<string, unknown>, caller = "leader") =>
    api.request("/takode/drafts/share", {
      method: "POST",
      headers: { "content-type": "application/json", "x-caller": caller },
      body: JSON.stringify(body),
    });
  /** The worker writes an answer; the Library reads it as it would after the session is saved. */
  const write = (sessionId: string, text: string) => {
    sessions.get(sessionId)!.messageHistory.push(assistant(text));
    library.sessionSaved(sessionId);
  };
  const leaderHistory = sessions.get("leader")!.messageHistory;
  return { share, write, library, store, sessions, leaderHistory };
}

type Report = Extract<BrowserIncomingMessage, { type: "markdown_report" }>;

function postOf(content: string) {
  return parseGroupedDraftPost(/```takode-post\n(.+)\n```/.exec(groupDraftPostsInMarkdown(content))![1]);
}

describe("sharing a worker's draft into a thread", () => {
  it("posts the newest version, part revisions merged, as the same Library artifact", async () => {
    const { share, write, library, store, sessions, leaderHistory } = await harness();
    write("worker", FIRST);
    write("worker", REVISION);

    // With no title or message, the worker's newest message with drafts is shared.
    const res = await share({ from: "worker", threadKey: "q-42" });
    expect(res.status).toBe(201);
    const receipt = await res.json();
    expect(receipt).toMatchObject({ threadKey: "q-42", drafts: [{ title: "Slack update", version: 2, parts: 2 }] });

    // The thread gets a report holding the whole post (the revised reply merged in), naming the
    // worker, and it is unread like any report.
    expect(leaderHistory).toHaveLength(1);
    const report = leaderHistory[0] as Report;
    expect(report).toMatchObject({ type: "markdown_report", threadKey: "q-42", questId: "q-42" });
    expect(report.sharedDraft).toMatchObject({ artifactId: receipt.drafts[0].artifactId, version: 2 });
    expect(report.sharedDraft).toMatchObject({ sessionId: "worker", sessionNum: 7 });
    const post = postOf(report.content);
    expect(post?.blocks.map((block) => block.body)).toEqual(["T7 evals start today.", "First reply, revised"]);
    expect(post?.blocks[0].destination?.url).toBe("https://example.slack.com/archives/C1/p1");
    expect(post?.blocks.map((block) => block.attachments)).toEqual([["/tmp/plot.png"], []]);
    expect(sessions.get("leader")!.notifications).toEqual([
      expect.objectContaining({ summary: "Report in q-42 | Draft: Slack update" }),
    ]);

    // No new artifact or version: the shared card is the worker's draft, now current in the
    // leader's thread, and the worker's own copy collapses as a repeat.
    await library.idle();
    expect(store.list({ kind: "post" }).total).toBe(1);
    expect(store.get(receipt.drafts[0].artifactId)?.versionCount).toBe(2);
    const [projected] = library.projectMessages("leader", leaderHistory);
    expect(projected.type === "markdown_report" && projected.artifacts).toEqual([
      expect.objectContaining({ id: receipt.drafts[0].artifactId, version: 2 }),
    ]);
    const workerView = library.projectMessages("worker", sessions.get("worker")!.messageHistory);
    expect(JSON.stringify(workerView[1])).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);

    // A newer version from the worker collapses the shared card, as for any replaced version.
    write("worker", REVISION.replace("revised", "revised again"));
    await library.idle();
    const [replaced] = library.projectMessages("leader", leaderHistory);
    expect(replaced.type === "markdown_report" && replaced.content).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
  });

  it("picks a draft by title, by Library ID, or by message, refusing a message revised since", async () => {
    const { share, write, leaderHistory } = await harness();
    write("worker", FIRST);
    write("worker", REVISION);

    const byTitle = await (await share({ from: "worker", title: "slack  UPDATE", threadKey: "t-3" })).json();
    expect(byTitle.drafts).toEqual([expect.objectContaining({ version: 2 })]);
    const prefix = byTitle.drafts[0].artifactId.slice(0, 8);
    const byId = await (await share({ artifact: prefix, threadKey: "q-42" })).json();
    expect(byId.drafts).toEqual([expect.objectContaining({ artifactId: byTitle.drafts[0].artifactId, version: 2 })]);
    expect((await share({ from: "worker", message: 1, threadKey: "q-42" })).status).toBe(201);

    // The first message holds version 1, which the second replaced: share the newest instead.
    const stale = await share({ from: "worker", message: 0, threadKey: "q-42" });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain(
      'revised since (version 2). Share the newest with --title "Slack update"',
    );
    expect(leaderHistory).toHaveLength(3);
  });

  it("shares only from the caller's own or herded sessions, never into a leader's Main", async () => {
    const { share, write, leaderHistory } = await harness();
    write("stranger", FIRST);
    write("worker", FIRST);
    expect((await share({ from: "stranger", threadKey: "q-42" })).status).toBe(403);
    const main = await share({ from: "worker", threadKey: "main" });
    expect(main.status).toBe(400);
    expect((await main.json()).error).toContain("Main is your log");
    expect((await share({ from: "worker", title: "Nope", threadKey: "q-42" })).status).toBe(404);
    write("worker", "No drafts in this one.");
    expect((await share({ from: "worker", message: 2, threadKey: "q-42" })).status).toBe(404);
    expect(leaderHistory).toHaveLength(0);
  });
});
