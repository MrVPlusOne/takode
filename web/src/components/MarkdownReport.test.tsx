// @vitest-environment jsdom
import { act, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMarkdownReportFixture } from "../../shared/test-fixtures/markdown-report.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { readConversationAnnotations } from "../../shared/conversation-annotations.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { groupIntoTurns } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import { MessageBubble } from "./MessageBubble.js";
import { captureAnnotationSource, resolveAnnotationRange } from "./annotation-passages.js";
import { ComposerAnnotations } from "./ComposerAnnotations.js";
import { applySessionDraftWrite } from "../../server/bridge/session-drafts-controller.js";
import { applySessionDraftsSnapshot, flushPendingDrafts, resetDraftSyncForTests } from "../draft-sync.js";

// Unsent report comments are part of the composer draft, which the server keeps for
// every browser of the user; this in-memory server uses the real draft controller.
const draftServer = vi.hoisted(() => ({ session: { id: "", notifications: [], drafts: undefined as any } }));
vi.mock("../api/session-drafts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/session-drafts.js")>()),
  writeSessionDraft: async (_sessionId: string, request: any) => {
    const result = applySessionDraftWrite(draftServer.session, request, {
      broadcastToBrowsers: () => {},
      persistSession: () => {},
    });
    if (!result.ok) throw new Error(result.error);
    return result.change;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useStore.setState({ composerDrafts: new Map(), annotationEditor: null });
  localStorage.clear();
});

describe("saved Markdown reports", () => {
  it("restores saved unsent comments and exact anchors after a page reload, then retires them after send", async () => {
    // Simulate reload by clearing the in-memory store and draft sync, then applying the server's drafts
    // the way the next subscribe snapshot does.
    const source = makeMarkdownReportFixture().source;
    draftServer.session = { id: source.sessionId, notifications: [], drafts: undefined };
    const draft = {
      text: "Follow up",
      images: [],
      annotations: [
        {
          id: "comment",
          selectedText: "one hour",
          comment: "Why?",
          sourceMessageId: source.reportId,
          sourceAnchor: { scopeIndex: 0, start: 8, end: 16, text: "one hour" },
          reportSource: source,
        },
      ],
    };
    act(() => useStore.getState().setComposerDraft(source.sessionId, draft));
    flushPendingDrafts();
    await vi.waitFor(() => expect(draftServer.session.drafts?.composer).toBeDefined());
    resetDraftSyncForTests();
    useStore.setState({ composerDrafts: new Map() });
    applySessionDraftsSnapshot(source.sessionId, draftServer.session.drafts);
    expect(useStore.getState().composerDrafts.get(source.sessionId)).toEqual(draft);
    act(() => useStore.getState().clearComposerDraft(source.sessionId));
    await vi.waitFor(() => expect(draftServer.session.drafts?.composer).toBeUndefined());
    resetDraftSyncForTests();
  });

  it.each([false, true])("keeps the complete report visible in collapsed feeds, leader=%s", (leader) => {
    // Use server-produced selected-window entries, not a frontend-only invented route shape.
    const report = makeMarkdownReportFixture();
    report.content += "\n[thread:q-99:C]\n{[(Thread Ready: q-99 | literal report text)]}\n";
    const window = buildThreadWindowSync({
      messageHistory: [report],
      threadKey: report.threadKey,
      fromItem: -1,
      itemCount: 2,
      sectionItemCount: 1,
      visibleItemCount: 2,
    });
    const messages = window.entries.flatMap((entry) =>
      normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    );
    expect(messages[0].content).toBe(report.content);
    const turns = groupIntoTurns(
      messages.map((msg) => ({ kind: "message" as const, msg })),
      leader,
    );
    expect(
      turns[0].collapsedEntries?.some(
        (entry) => entry.kind === "entry" && entry.entry.kind === "message" && entry.entry.msg.id === report.id,
      ),
    ).toBe(true);
    expect(turns[0].responseEntry).toBeNull();
    render(
      <div data-message-id={report.id} data-message-role="assistant">
        <MessageBubble message={messages[0]} sessionId={report.source.sessionId} />
      </div>,
    );
    expect(screen.getByText("Final source detail retained.")).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(35);
    expect(screen.getByRole("link", { name: "source 35" }).getAttribute("href")).toBe("https://example.com/updates/35");
    expect(screen.getByText(/literal report text/)).toBeTruthy();
  });

  it("renders HTML inertly and restores the exact repeated passage after remount", () => {
    const report = makeMarkdownReportFixture();
    report.content =
      "# Report\n\nRepeated **passage**.\n\nRepeated **passage**.\n\n<script>window.reportExecuted=true</script>";
    const [message] = normalizeHistoryMessageToChatMessages(report, 0);
    const view = render(
      <div data-message-id={report.id} data-message-role="assistant">
        <MessageBubble message={message} sessionId={report.source.sessionId} />
      </div>,
    );
    expect(view.container.querySelector("script")).toBeNull();
    const paragraph = view.container.querySelectorAll(".markdown-body p")[1];
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const captured = captureAnnotationSource(range);
    const annotation = {
      id: "comment",
      selectedText: range.toString(),
      comment: "Explain the second occurrence.",
      ...captured,
    };
    expect(captured.reportSource).toEqual(report.source);
    expect(readConversationAnnotations([annotation])[0]).toEqual(annotation);
    view.unmount();
    const next = render(
      <div data-message-id={report.id} data-message-role="assistant">
        <MessageBubble message={message} sessionId={report.source.sessionId} />
      </div>,
    );
    const restored = resolveAnnotationRange(next.container.querySelector("[data-message-id]")!, annotation);
    expect(restored?.toString()).toBe(annotation.selectedText);
    expect(restored?.startContainer.parentElement?.closest("p")).toBe(
      next.container.querySelectorAll(".markdown-body p")[1],
    );
  });

  it("keeps malformed relative links readable without breaking the rest of the report", () => {
    // Invalid escaping is permitted in source text and must not throw during path resolution.
    const report = makeMarkdownReportFixture();
    report.source.sourcePath = "/project/report #1/daily.md";
    report.content = "[malformed](relative%zz.md)\n\nLast paragraph remains visible.";
    const [message] = normalizeHistoryMessageToChatMessages(report, 0);
    render(<MessageBubble message={message} sessionId={report.source.sessionId} />);
    expect(screen.getByRole("link", { name: "malformed" })).toBeTruthy();
    expect(screen.getByText("Last paragraph remains visible.")).toBeTruthy();
  });

  it("lists saved report comments in the composer without asking who receives them", () => {
    // Report comments go to the session showing the report, like any other comment, so the
    // composer shows the saved comment and no recipient choice.
    const report = makeMarkdownReportFixture();
    useStore.getState().setComposerDraft(report.source.sessionId, {
      text: "",
      images: [],
      annotations: [
        { id: "a", selectedText: "one hour", comment: "Why?", sourceMessageId: report.id, reportSource: report.source },
      ],
    });
    render(<ComposerAnnotations sessionId={report.source.sessionId} threadKey={report.threadKey} />);
    expect(screen.getByTestId("annotation-attachments").textContent).toContain("Comment 1");
    expect(screen.queryByLabelText("Report comment recipient")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
