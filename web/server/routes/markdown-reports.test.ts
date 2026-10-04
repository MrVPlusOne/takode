import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownReportRoutes } from "./markdown-reports.js";
import type { RouteContext } from "./context.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { SessionStore, type PersistedSession } from "../session-store.js";
import { readMarkdownReportFile } from "../../bin/markdown-report-file.js";
import { makeMarkdownReportFixture } from "../../shared/test-fixtures/markdown-report.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { resolveSessionMessageTarget } from "../session-message-search.js";
import { formatAnnotatedMessage } from "../../shared/conversation-annotations.js";
import { buildProgrammaticUserMessage } from "../session-pause.js";
import { prepareAnnotatedUserMessage } from "../bridge/user-message-delivery.js";

function harness() {
  const sessions = new Map([
    ["report-host", { sessionId: "report-host", isOrchestrator: true, archived: false }],
    ["report-worker", { sessionId: "report-worker", isOrchestrator: false, archived: false, herdedBy: "report-host" }],
  ]);
  const history: BrowserIncomingMessage[] = [];
  const host = { id: "report-host", messageHistory: history };
  const inject = vi.fn((_id, _content, _source, _batch, _route, options) => {
    options.afterAccepted();
    return "sent";
  });
  const persist = vi.fn();
  const ctx = {
    authenticateTakodeCaller: (c: any) =>
      c.req.header("x-agent") === "valid"
        ? { callerId: host.id, caller: sessions.get(host.id) }
        : { response: c.json({ error: "unauthorized" }, 403) },
    authenticateCompanionCallerOptional: (c: any) =>
      c.req.header("x-agent") ? { callerId: host.id, caller: sessions.get(host.id) } : null,
    resolveId: (id: string) => (sessions.has(id) ? id : null),
    launcher: { getSession: (id: string) => sessions.get(id), getSessionNum: () => 7 },
    wsBridge: {
      getSession: (id: string) => (id === host.id ? host : sessions.has(id) ? { id, messageHistory: [] } : null),
      persistSessionById: persist,
      broadcastToSession: vi.fn(),
      refreshSessionConversation: vi.fn(),
      injectUserMessage: inject,
    },
  } as unknown as RouteContext;
  const api = createMarkdownReportRoutes(ctx);
  const post = (path: string, body: unknown, agent = false) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(agent ? { "x-agent": "valid" } : {}) },
      body: JSON.stringify(body),
    });
  return { ctx, host, sessions, inject, persist, post };
}

describe("Markdown report publication and human comments", () => {
  it("persists the exact local snapshot and source identity after the file changes", async () => {
    // Exercise actual local-file reading, route publication, disk roundtrip and producer-owned windows.
    const root = await mkdtemp(join(tmpdir(), "markdown-report-"));
    const h = harness();
    try {
      const original =
        "\uFEFF" + makeMarkdownReportFixture().content + "\r\n[thread:q-99:C]\n<script>throw 1</script>\n";
      const file = join(root, "daily.md");
      await writeFile(file, original);
      const source = await readMarkdownReportFile(file);
      const response = await h.post(
        "/takode/reports",
        { ...source, threadKey: "q-42", responsibleWorkerId: "report-worker" },
        true,
      );
      expect(response.status).toBe(201);
      const receipt = await response.json();
      expect(JSON.stringify(receipt)).not.toContain("Daily engineering");
      expect(receipt.sha256).toBe(createHash("sha256").update(original).digest("hex"));
      expect(h.persist).toHaveBeenCalledWith("report-host");
      await writeFile(file, "changed later");
      const store = new SessionStore(join(root, "sessions"));
      const saved = {
        id: "report-host",
        state: { session_id: "report-host" },
        messageHistory: h.host.messageHistory,
        pendingMessages: [],
        pendingPermissions: [],
      } as unknown as PersistedSession;
      store.save(saved);
      await store.flushAll();
      const reloaded = await new SessionStore(join(root, "sessions")).load("report-host");
      expect(reloaded?.messageHistory[0]).toMatchObject({
        content: original,
        source: { sourcePath: file, sha256: receipt.sha256 },
      });
      for (const threadKey of ["q-42", "all", "main"]) {
        const window = buildThreadWindowSync({
          messageHistory: reloaded!.messageHistory,
          threadKey,
          fromItem: -1,
          itemCount: 3,
          sectionItemCount: 1,
          visibleItemCount: 3,
        });
        expect(window.entries.some((entry) => entry.message.type === "markdown_report")).toBe(threadKey !== "main");
      }
      expect(resolveSessionMessageTarget(reloaded!.messageHistory, receipt.reportId, true)).toEqual({
        messageId: receipt.reportId,
        threadKey: "q-42",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid local files, UTF-8 and oversized sources without partial publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "report-invalid-"));
    try {
      const path = join(root, "daily.md");
      await expect(readMarkdownReportFile(path)).rejects.toThrow();
      await writeFile(path, Buffer.from([0xff, 0xfe]));
      await expect(readMarkdownReportFile(path)).rejects.toThrow();
      await writeFile(path, "x".repeat(2 * 1024 * 1024 + 1));
      await expect(readMarkdownReportFile(path)).rejects.toThrow("2 MiB");
      const h = harness();
      for (const content of ["", "\0", "\ud800", "x".repeat(2 * 1024 * 1024 + 1)]) {
        expect((await h.post("/takode/reports", { sourcePath: path, content, threadKey: "main" }, true)).status).toBe(
          400,
        );
      }
      expect(h.host.messageHistory).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires publication authentication, an own-session target and a related worker", async () => {
    const h = harness();
    const body = { content: "# Report", sourcePath: "/unread/server/path.md", threadKey: "main" };
    expect((await h.post("/takode/reports", body)).status).toBe(403);
    expect((await h.post("/takode/reports", { ...body, sessionId: "report-worker" }, true)).status).toBe(403);
    h.sessions.get("report-worker")!.herdedBy = "another-leader";
    expect((await h.post("/takode/reports", { ...body, responsibleWorkerId: "report-worker" }, true)).status).toBe(403);
    // A valid upload succeeds even when the server has no such path: this API never reads it.
    expect((await h.post("/takode/reports", body, true)).status).toBe(201);
  });

  it.each([
    "report-host",
    "report-worker",
  ])("delivers complete human context to %s without borrowing source identity", async (recipientSessionId) => {
    const h = harness();
    const report = makeMarkdownReportFixture();
    h.host.messageHistory.push(report);
    const annotation = {
      id: "comment",
      selectedText: "The cache expires after one hour.",
      comment: "Explain this exactly.\nKeep this line.",
      sourceMessageId: report.id,
      reportSource: report.source,
      sourceAnchor: { scopeIndex: 0, start: 10, end: 43, text: "The cache expires after one hour." },
    };
    const body = { content: "Follow up", annotations: [annotation], threadKey: "q-42", recipientSessionId };
    const response = await h.post("/sessions/report-host/report-annotations", body);
    expect(response.status).toBe(200);
    const call = h.inject.mock.calls[0];
    expect(call[0]).toBe(recipientSessionId);
    expect(call[2]).toBeUndefined(); // This is human input, never a forged leader/agent send.
    expect(call[4].threadKey).toBe(recipientSessionId === "report-host" ? "q-42" : "main");
    expect(call[5].annotations).toEqual([annotation]);
    const paused = buildProgrammaticUserMessage({ content: body.content, options: call[5] });
    expect(paused.annotations).toEqual([annotation]);
    const delivery = prepareAnnotatedUserMessage(recipientSessionId, paused);
    expect(delivery.deliveryContent).toContain(formatAnnotatedMessage(body.content, [annotation]));
    expect(delivery.deliveryContent).toContain(report.source.sha256);
  });

  it("rejects stale recipients, foreign sources, agent impersonation and failed delivery", async () => {
    const h = harness();
    const report = makeMarkdownReportFixture();
    h.host.messageHistory.push(report);
    const body = {
      content: "",
      threadKey: "q-42",
      recipientSessionId: "report-worker",
      annotations: [
        {
          id: "comment",
          selectedText: "one hour",
          comment: "Why?",
          sourceMessageId: report.id,
          reportSource: report.source,
        },
      ],
    };
    expect((await h.post("/sessions/report-host/report-annotations", body, true)).status).toBe(403);
    h.sessions.get("report-worker")!.herdedBy = "new-leader";
    expect((await h.post("/sessions/report-host/report-annotations", body)).status).toBe(400);
    h.sessions.get("report-worker")!.herdedBy = "report-host";
    h.sessions.get("report-worker")!.archived = true;
    expect((await h.post("/sessions/report-host/report-annotations", body)).status).toBe(409);
    h.sessions.get("report-worker")!.archived = false;
    body.annotations[0].reportSource = { ...report.source, sessionId: "foreign" };
    expect((await h.post("/sessions/report-host/report-annotations", body)).status).toBe(400);
    expect(h.inject).not.toHaveBeenCalled();
    body.annotations[0].reportSource = report.source;
    h.inject.mockImplementation((_id, _content, _source, _batch, _route, options) => {
      options.afterRejected("route_failed");
      return "queued";
    });
    expect((await h.post("/sessions/report-host/report-annotations", body)).status).toBe(409);
  });
});
