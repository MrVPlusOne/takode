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
});
