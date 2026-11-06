// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import type { ChatMessage } from "../types.js";
import { setSecondaryViewTarget, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { captureAnnotationSource } from "./annotation-passages.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MarkdownReport } from "./MarkdownReport.js";

/**
 * Long artifacts open from a button in their card's header. Wide screens show them in the
 * secondary view, the resizable panel that slides in from the right (the app shell registers it as
 * the dock target); without one, such as on phones, they cover the window. Either way a report
 * keeps working as in the feed (selected text is captured as a comment on the report's message,
 * with the same anchor the feed would record), and Escape or Close returns.
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

/** Registers a stand-in for the secondary view's content area, as the wide-screen app shell does. */
function dockArea(): HTMLDivElement {
  const area = document.createElement("div");
  document.body.appendChild(area);
  act(() => setSecondaryViewTarget(area));
  return area;
}

afterEach(() => {
  cleanup();
  act(() => setSecondaryViewTarget(null));
  document.body.innerHTML = "";
});

describe("artifact panel", () => {
  it("opens a report in the side panel on wide screens, standing in for its message so comments point at it", () => {
    const area = dockArea();
    render(<MarkdownReport message={report} feedSessionId="leader-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));

    // It renders into the secondary view, not over the whole window, and is not modal there.
    const panel = within(area).getByTestId("artifact-panel");
    expect(panel).toHaveAccessibleName("Formal verification explained");
    expect(panel).not.toHaveAttribute("aria-modal");
    const content = within(panel).getByTestId("markdown-report-panel");
    expect(content).toHaveTextContent("The idea in one paragraph.");
    // The panel's width, which the user drags, sets the line length: no column cap inside it.
    expect(panel.querySelector(".max-w-4xl")).toBeNull();
    // The read-aloud and More controls come along in the title bar.
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

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
  });

  it("covers the window where there is no side panel, with the report in a bounded column", () => {
    render(<MarkdownReport message={report} feedSessionId="leader-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const panel = screen.getByTestId("artifact-panel");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel.parentElement).toBe(document.body);
    expect(panel.querySelector(".max-w-4xl")).toContainElement(screen.getByTestId("markdown-report-panel"));
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
  });

  it("leaves Escape to a viewer opened on top of it in the side panel", () => {
    // Such as quest details opened from a quest link in the report: Escape closes that first.
    const area = dockArea();
    function ViewerOnTop() {
      const target = useSecondaryViewTarget(true, () => {}, "reading");
      return target ? createPortal(<div data-testid="viewer-on-top" />, target) : null;
    }
    const feed = (viewerOnTop: boolean) => (
      <>
        <MarkdownReport message={report} feedSessionId="leader-1" />
        {viewerOnTop && <ViewerOnTop />}
      </>
    );
    const view = render(feed(false));
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));
    view.rerender(feed(true));
    expect(area.lastElementChild).toBe(screen.getByTestId("viewer-on-top"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(area).getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("opens a post's card the same way, without another open button inside", () => {
    const area = dockArea();
    render(<MarkdownContent text={"```draft\ntitle: T7 status\n---\nMessage\n```\n```draft\nReply\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));
    const panel = within(area).getByTestId("artifact-panel");
    expect(within(panel).getByTestId("draft-post-card")).toHaveTextContent("Reply");
    expect(within(panel).queryByTestId("artifact-panel-button")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
  });
});
