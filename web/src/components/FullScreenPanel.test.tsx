// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import type { ChatMessage } from "../types.js";
import { captureAnnotationSource } from "./annotation-passages.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MarkdownReport } from "./MarkdownReport.js";

/**
 * Long artifacts open full screen from a button in their card's header: a report keeps working
 * as in the feed (selected text is captured as a comment on the report's message, with the same
 * anchor the feed would record), and a post shows its card large. Escape or Close returns.
 */

const report: ChatMessage = {
  id: "report-1",
  role: "assistant",
  content: "# Formal verification explained\n\nThe idea in one paragraph.",
  timestamp: 10,
  metadata: {
    markdownReport: { sessionId: "s1", reportId: "r1", sourcePath: "/tmp/formal-verification.md", sha256: "x" },
  },
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("full-screen artifacts", () => {
  it("opens a report full screen, standing in for its message so comments point at it", () => {
    render(<MarkdownReport message={report} feedSessionId="leader-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const panel = screen.getByTestId("full-screen-panel");
    expect(panel).toHaveAccessibleName("Formal verification explained");
    const content = within(panel).getByTestId("markdown-report-full-screen");
    expect(content).toHaveTextContent("The idea in one paragraph.");
    // The copy and read-aloud controls come along in the title bar.
    expect(within(panel).getByRole("button", { name: "Read aloud" })).toBeInTheDocument();

    // Selecting text there records the same source as in the feed: the report's message,
    // its report file, and an anchor in its one selectable body.
    const text = within(content).getByText("The idea in one paragraph.").firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 8);
    expect(captureAnnotationSource(range)).toMatchObject({
      sourceMessageId: "report-1",
      reportSource: { sourcePath: "/tmp/formal-verification.md" },
      sourceAnchor: { scopeIndex: 0, text: "idea" },
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("full-screen-panel")).toBeNull();
  });

  it("opens a post's card full screen, without another full-screen button inside", () => {
    render(<MarkdownContent text={"```draft\ntitle: T7 status\n---\nMessage\n```\n```draft\nReply\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const panel = screen.getByTestId("full-screen-panel");
    expect(within(panel).getByTestId("draft-post-card")).toHaveTextContent("Reply");
    expect(within(panel).queryByRole("button", { name: "Full screen" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("full-screen-panel")).toBeNull();
  });
});
