import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownReportRoutes } from "./markdown-reports.js";
import type { RouteContext } from "./context.js";
import type { BrowserIncomingMessage, SessionNotification } from "../session-types.js";
import { SessionStore, type PersistedSession } from "../session-store.js";
import { readMarkdownReportFile } from "../../bin/markdown-report-file.js";
import { makeMarkdownReportFixture } from "../../shared/test-fixtures/markdown-report.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { resolveSessionMessageTarget } from "../session-message-search.js";
import { formatAnnotatedMessage } from "../../shared/conversation-annotations.js";
import { prepareAnnotatedUserMessage } from "../bridge/user-message-delivery.js";
import { isHistoryBackedEvent } from "../bridge/replay-buffer-policy.js";
import {
  shouldDeliverBrowserEventToSocket,
  prepareBoundedConversationSubscribe,
} from "../bridge/browser-conversation-window-policy.js";

function harness() {
  const sessions = new Map([
    ["report-host", { sessionId: "report-host", isOrchestrator: true, archived: false }],
    ["report-worker", { sessionId: "report-worker", isOrchestrator: false, archived: false, herdedBy: "report-host" }],
  ]);
  const history: BrowserIncomingMessage[] = [];
  const host = { id: "report-host", messageHistory: history, state: {}, notifications: [] as SessionNotification[] };
  const persist = vi.fn();
  const notificationDeps = {
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    promoteLeaderThreadTabForAttention: vi.fn(),
  };
  const ctx = {
    authenticateTakodeCaller: (c: any) =>
      c.req.header("x-agent") === "valid"
        ? { callerId: host.id, caller: sessions.get(host.id) }
        : { response: c.json({ error: "unauthorized" }, 403) },
    resolveId: (id: string) => (sessions.has(id) ? id : null),
    launcher: { getSession: (id: string) => sessions.get(id) },
    wsBridge: {
      getSession: (id: string) => (id === host.id ? host : sessions.has(id) ? { id, messageHistory: [] } : null),
      persistSessionById: persist,
      broadcastToSession: vi.fn(),
      refreshSessionConversation: vi.fn(),
      getSessionNotificationDeps: () => notificationDeps,
    },
  } as unknown as RouteContext;
  const api = createMarkdownReportRoutes(ctx);
  const post = (path: string, body: unknown, agent = false) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(agent ? { "x-agent": "valid" } : {}) },
      body: JSON.stringify(body),
    });
  return { ctx, host, sessions, persist, post, notificationDeps };
}

describe("Markdown report publication and human comments", () => {
  it("keeps live reports scoped to their selected thread and hydrates them once on reconnect", () => {
    // A new history event must join both the bounded fan-out and replay classifications.
    const report = makeMarkdownReportFixture();
    const session = { messageHistory: [report], eventBuffer: [{ seq: 1, message: report }], nextEventSeq: 2 };
    for (const threadKey of ["main", "q-42", "q-99"]) {
      const socketData = {
        conversationView: {
          kind: "thread" as const,
          request: { threadKey, fromItem: -1, itemCount: 3, sectionItemCount: 1, visibleItemCount: 3 },
        },
      };
      expect(shouldDeliverBrowserEventToSocket(session, report, socketData)).toBe(threadKey === "q-42");
    }
    expect(shouldDeliverBrowserEventToSocket(session, report, {})).toBe(false);
    const subscribe = prepareBoundedConversationSubscribe({
      session,
      socketData: {},
      initialThreadWindow: {
        thread_key: "q-42",
        from_item: -1,
        item_count: 3,
        section_item_count: 1,
        visible_item_count: 3,
      },
      historyWindowSectionTurnCount: 1,
      historyWindowVisibleSectionCount: 3,
      historyWindowTargetMessageId: undefined,
      historyWindowTargetIndex: undefined,
      lastAckSeq: 0,
      running: true,
      isHistoryBackedEvent,
    });
    expect(subscribe.replayEvents).toEqual([]);
  });

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
      expect(isHistoryBackedEvent(reloaded!.messageHistory[0] as any)).toBe(true);
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

  it("makes a leader's report thread unread, and only a leader's", async () => {
    // A report is written for the user to read even when nothing asked for it, such as
    // a briefing a worker produced on its own schedule, so publishing it makes its
    // thread unread, anchored on the report. A worker's own session gets no unread.
    const h = harness();
    const body = { content: "# Daily briefing: Friday\n\nNews", sourcePath: "/briefing.md", threadKey: "q-42" };
    const response = await h.post("/takode/reports", body, true);
    const { reportId } = await response.json();
    expect(h.host.notifications).toEqual([
      expect.objectContaining({
        category: "review",
        unreadReason: "report",
        messageId: reportId,
        threadKey: "q-42",
        questId: "q-42",
        summary: "Report in q-42 | Daily briefing: Friday",
        done: false,
      }),
    ]);
    expect(h.notificationDeps.promoteLeaderThreadTabForAttention).toHaveBeenCalledWith(
      "report-host",
      "q-42",
      expect.any(Number),
      "review",
    );

    h.sessions.get("report-host")!.isOrchestrator = false;
    await h.post("/takode/reports", body, true);
    expect(h.host.messageHistory).toHaveLength(2);
    expect(h.host.notifications).toHaveLength(1);
  });

  it("delivers a report comment as ordinary composer input that names the report to read", () => {
    // Report comments use the normal composer send to the session showing the report, with no
    // recipient choice. The agent may not have written or read the report, so the delivered text
    // must name its source file next to the quoted passage and comment; the report and session
    // IDs stay in the structured annotation, not in the text.
    const report = makeMarkdownReportFixture();
    const annotation = {
      id: "comment",
      selectedText: "The cache expires after one hour.",
      comment: "Explain this exactly.\nKeep this line.",
      sourceMessageId: report.id,
      reportSource: report.source,
      sourceAnchor: { scopeIndex: 0, start: 10, end: 43, text: "The cache expires after one hour." },
    };
    const delivery = prepareAnnotatedUserMessage(report.source.sessionId, {
      type: "user_message",
      content: "Follow up",
      annotations: [annotation],
      threadKey: report.threadKey,
      inputSource: "composer",
    } as any);
    expect(delivery.annotations).toEqual([annotation]);
    expect(delivery.deliveryContent).toBe(formatAnnotatedMessage("Follow up", [annotation]));
    expect(delivery.deliveryContent).toContain(
      `On report ${report.source.sourcePath}:\n> The cache expires after one hour.\n[comment 1] Explain this exactly.`,
    );
    expect(delivery.deliveryContent).not.toContain(report.source.reportId);
    expect(delivery.deliveryContent).not.toContain(report.source.sessionId);
  });

  it("offers no separate report-comment route", async () => {
    // The retired recipient route must not linger as a second way to send report comments.
    const h = harness();
    expect((await h.post("/sessions/report-host/report-annotations", { content: "" })).status).toBe(404);
  });
});
