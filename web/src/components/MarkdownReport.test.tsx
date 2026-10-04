// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, cleanup } from "@testing-library/react";
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
import { useReportCommentSend } from "./use-report-comment-send.js";
import { useReportCommentDraft } from "./use-report-comment-draft.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useStore.setState({ composerDrafts: new Map(), annotationEditor: null });
  localStorage.clear();
});

describe("saved Markdown reports", () => {
  it("restores saved unsent comments and exact anchors after a page reload, then retires them after send", () => {
    // Simulate reload by unmounting subscribers and recreating the in-memory store from scoped storage.
    const source = makeMarkdownReportFixture().source;
    const draft = {
      text: "Follow up",
      images: [],
      reportRecipientSessionId: "report-worker",
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
    localStorage.setItem("cc-server-id", "server-one");
    const first = renderHook(() => useReportCommentDraft(source.sessionId));
    act(() => useStore.getState().setComposerDraft(source.sessionId, draft));
    first.unmount();
    useStore.setState({ composerDrafts: new Map() });
    const second = renderHook(() => useReportCommentDraft(source.sessionId));
    expect(useStore.getState().composerDrafts.get(source.sessionId)).toEqual(draft);
    act(() => useStore.getState().clearComposerDraft(source.sessionId));
    expect(localStorage.getItem(`server-one:report-comment-draft:${source.sessionId}`)).toBeNull();
    second.unmount();
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

  it("requires explicit recipient choice and retains the draft on server rejection", async () => {
    const report = makeMarkdownReportFixture();
    const draft = {
      text: "",
      images: [],
      annotations: [
        { id: "a", selectedText: "one hour", comment: "Why?", sourceMessageId: report.id, reportSource: report.source },
      ],
    };
    useStore.getState().setComposerDraft(report.source.sessionId, draft);
    render(<ComposerAnnotations sessionId={report.source.sessionId} threadKey={report.threadKey} />);
    expect((screen.getByLabelText("Report comment recipient") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Report comment recipient"), { target: { value: "report-worker" } });
    const selected = useStore.getState().composerDrafts.get(report.source.sessionId);
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Worker unavailable" }) });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useReportCommentSend(report.source.sessionId, report.threadKey));
    await act(async () => {
      expect(await result.current.send()).toBe(false);
    });
    expect(result.current.status).toBe("Worker unavailable");
    expect(useStore.getState().composerDrafts.get(report.source.sessionId)).toBe(selected);
    expect(JSON.parse(fetch.mock.calls[0][1].body).recipientSessionId).toBe("report-worker");
    fetch.mockResolvedValue({ ok: true, json: async () => ({ recipientSessionId: "report-worker" }) });
    await act(async () => {
      expect(await result.current.send()).toBe(true);
    });
    expect(useStore.getState().composerDrafts.has(report.source.sessionId)).toBe(false);
  });

  it("does not erase a newly edited draft when an earlier send is acknowledged", async () => {
    const report = makeMarkdownReportFixture();
    const draft = {
      text: "original",
      images: [],
      reportRecipientSessionId: report.source.sessionId,
      annotations: [
        { id: "a", selectedText: "one hour", comment: "Why?", sourceMessageId: report.id, reportSource: report.source },
      ],
    };
    useStore.getState().setComposerDraft(report.source.sessionId, draft);
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const { result } = renderHook(() => useReportCommentSend(report.source.sessionId, report.threadKey));
    let sent!: Promise<boolean>;
    act(() => {
      sent = result.current.send();
    });
    const edited = { ...draft, text: "new question" };
    useStore.getState().setComposerDraft(report.source.sessionId, edited);
    await act(async () => {
      finish({ ok: true, json: async () => ({ recipientSessionId: report.source.sessionId }) });
      await sent;
    });
    expect(useStore.getState().composerDrafts.get(report.source.sessionId)).toBe(edited);
  });
});
