// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types.js";
import type { ReadAloudState } from "../read-aloud-player.js";

const player = vi.hoisted(() => ({
  state: null as ReadAloudState | null,
  startReadAloud: vi.fn(),
  stopReadAloud: vi.fn(),
}));
vi.mock("../read-aloud-player.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../read-aloud-player.js")>()),
  startReadAloud: player.startReadAloud,
  stopReadAloud: player.stopReadAloud,
  useReadAloudState: (messageId: string) => (player.state?.messageId === messageId ? player.state : null),
  useCurrentReadAloud: () => player.state,
}));

import { MarkdownReport } from "./MarkdownReport.js";
import { MessageBubble } from "./MessageBubble.js";
import { makeSharedDraftFixture } from "../../shared/test-fixtures/markdown-report.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";

const report: ChatMessage = {
  id: "report-1",
  role: "assistant",
  content: "# Findings\n\nAll good.",
  timestamp: 10,
  historyIndex: 12,
  metadata: { markdownReport: { sessionId: "s1", reportId: "r1", sourcePath: "/tmp/findings.md", sha256: "x" } },
};

describe("MarkdownReport read aloud", () => {
  beforeEach(() => {
    player.state = null;
    vi.clearAllMocks();
  });

  it("reads the report from the speaker in its header", () => {
    // Reports have no message menu, so Read aloud lives in the header next to Copy Markdown.
    render(<MarkdownReport message={report} />);
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(player.startReadAloud).toHaveBeenCalledWith({
      sessionId: "s1",
      messageId: "report-1",
      text: "# Findings\n\nAll good.",
      historyIndex: 12,
    });
  });

  it("shows the player above the report and offers Stop while reading", () => {
    player.state = { messageId: "report-1", sessionId: "s1", status: "ready" };
    render(<MarkdownReport message={report} />);
    const playerBox = screen.getByTestId("read-aloud-player");
    const card = screen.getByTestId("report-card");
    expect(playerBox.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The header speaker turns into Stop (the player's close button stops too).
    fireEvent.click(within(card).getByRole("button", { name: "Stop reading aloud" }));
    expect(player.stopReadAloud).toHaveBeenCalled();
  });

  it("has no Read aloud in read-only views", () => {
    render(<MarkdownReport message={report} readOnly />);
    expect(screen.queryByRole("button", { name: "Read aloud" })).toBeNull();
  });

  it("reads a shared draft from its card's header, in a player above it", () => {
    // A shared draft is a report with no other Read aloud: its card's speaker reads the post (the
    // card's own text), keyed to its message so the player and Stop work as for a whole message.
    const [draft] = normalizeHistoryMessageToChatMessages(makeSharedDraftFixture(), 0);
    const { unmount } = render(<MarkdownReport message={draft!} />);
    fireEvent.click(within(screen.getByTestId("draft-post-card")).getByRole("button", { name: "Read aloud" }));
    const part = "draft:Cache rollout update";
    expect(player.startReadAloud).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "report-host", messageId: "shared-draft-fixture", part }),
    );
    const text = player.startReadAloud.mock.calls[0]![0].text as string;
    expect(text).toMatch(/^<draft>\nTitle: Cache rollout update\nGoes to: #cache-rollout thread\n/);
    expect(text).toContain("Reply 1:\nHit rate settled at 92% after a day.");

    player.state = { messageId: "shared-draft-fixture", sessionId: "report-host", status: "ready", part };
    unmount();
    render(<MarkdownReport message={draft!} />);
    expect(screen.getByTestId("read-aloud-player")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("draft-post-card")).getByRole("button", { name: "Stop reading aloud" }));
    expect(player.stopReadAloud).toHaveBeenCalled();
  });

  it("reads a draft card in an assistant message from its header", () => {
    // Drafts in ordinary messages get the same speaker, reading only that card, while the
    // message's own Read aloud reads the whole message, drafts included.
    const message: ChatMessage = {
      id: "assistant-7",
      role: "assistant",
      content: "Here it is.\n\n```draft\ntitle: Launch note\n---\nWe ship **today**.\n```",
      timestamp: 10,
      historyIndex: 4,
    };
    render(<MessageBubble message={message} sessionId="s1" />);
    fireEvent.click(within(screen.getByTestId("draft-post-card")).getByRole("button", { name: "Read aloud" }));
    expect(player.startReadAloud).toHaveBeenCalledWith({
      sessionId: "s1",
      messageId: "assistant-7",
      historyIndex: 4,
      text: "<draft>\nTitle: Launch note\nWe ship **today**.\n</draft>",
      part: "draft:Launch note",
    });
  });

  it("has no draft-card Read aloud in read-only views", () => {
    const message: ChatMessage = {
      id: "assistant-8",
      role: "assistant",
      content: "```draft\nHello.\n```",
      timestamp: 10,
    };
    render(<MessageBubble message={message} sessionId="s1" interactionMode="read-only" />);
    expect(within(screen.getByTestId("draft-post-card")).queryByRole("button", { name: "Read aloud" })).toBeNull();
  });
});
