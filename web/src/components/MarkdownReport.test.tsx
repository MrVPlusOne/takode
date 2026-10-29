// @vitest-environment jsdom
import { act, render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

  it("opens full screen from its header and keeps the Library, copying and export in More", async () => {
    // The Library button and the full-screen button both opened the report, so the header keeps
    // full screen and Read aloud; the Library, Copy Markdown and the exports moved to More. A PDF
    // export sends the report as a standalone light page to the server and downloads the file.
    const report = makeMarkdownReportFixture();
    report.content = "# Daily engineering report\n\nThe cache expires after **one hour**.";
    const [message] = normalizeHistoryMessageToChatMessages(report, 0);
    message.metadata = {
      ...message.metadata,
      artifacts: [{ id: "artifact-r", kind: "report", title: "Daily engineering report", version: 2, versionCount: 2 }],
    };
    const fetchMock = vi.fn(async () => new Response(new Blob(["%PDF-"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    render(<MessageBubble message={message} sessionId={report.source.sessionId} />);

    expect(screen.getByRole("button", { name: "Full screen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /in Library/ })).toBeNull();
    fireEvent.click(screen.getByTestId("card-more-menu"));
    expect(screen.getByRole("button", { name: "Open version 2 of 2 in Library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Markdown" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      ["Markdown (.md)", "PDF (.pdf)", "Image (.png)", "Web page (.html)"].map(
        (name) => !!screen.getByRole("button", { name }),
      ),
    ).toEqual([true, true, true, true]);
    fireEvent.click(screen.getByRole("button", { name: "PDF (.pdf)" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/exports/document");
    const body = JSON.parse(String(init.body)) as { html: string; format: string };
    expect(body.format).toBe("pdf");
    expect(body.html).toContain("<title>Daily engineering report</title>");
    expect(body.html).toContain("one hour");
    // Controls stay out of the export.
    expect(body.html).not.toContain("More options");
  });

  it("names a report by its Library title, else by its first heading", () => {
    // The pinned bar of an expanded report and its full-screen view carry this title. The
    // Library's name is the agent's or the user's choice, so it wins over the heading.
    const report = makeMarkdownReportFixture();
    const [message] = normalizeHistoryMessageToChatMessages(report, 0);
    const view = render(<MessageBubble message={message} sessionId={report.source.sessionId} />);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Daily engineering report");
    view.unmount();

    message.metadata = {
      ...message.metadata,
      artifacts: [{ id: "artifact-r", kind: "report", title: "Cache follow-ups", version: 1, versionCount: 1 }],
    };
    render(<MessageBubble message={message} sessionId={report.source.sessionId} />);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Cache follow-ups");
  });
});
