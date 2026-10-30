// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMarkdownReportFixture } from "../../../shared/test-fixtures/markdown-report.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { ArtifactVersionContentView } from "../ArtifactInline.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MessageBubble } from "../MessageBubble.js";

// A deck as an agent writes it: front matter, a title slide, and slides with ## headings.
const DECK = [
  "---",
  "slides: true",
  "---",
  "",
  "# Cache walkthrough",
  "",
  "*What we cache and why.*",
  "",
  "---",
  "",
  "## What goes into a key",
  "",
  "File contents, not timestamps.",
  "",
  "---",
  "",
  "## Next steps",
  "",
  "1. Share the cache.",
].join("\n");

/** The deck published as a report and shown the way the conversation shows it. */
function renderDeckReport() {
  const report = { ...makeMarkdownReportFixture(), content: DECK };
  const [message] = normalizeHistoryMessageToChatMessages(report, 0);
  return render(<MessageBubble message={message} sessionId={report.source.sessionId} />);
}

/** jsdom lays nothing out, so give every element the width a deck would get on screen. */
function setBoxWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("slide decks in the conversation", () => {
  it("shows a deck report one slide at a time instead of the long report card", () => {
    setBoxWidth(900);
    renderDeckReport();
    expect(screen.queryByTestId("report-card")).not.toBeInTheDocument();
    const card = screen.getByTestId("slide-deck-card");
    expect(within(card).getByText("3 slides")).toBeInTheDocument();
    // The front matter is not shown; the title slide is, centered on the stage.
    expect(card).not.toHaveTextContent("slides: true");
    expect(screen.getByRole("heading", { name: "Cache walkthrough" }).closest("[data-slide-fit]")).toHaveClass(
      "my-auto",
    );
    expect(screen.queryByText("What goes into a key")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByRole("heading", { name: "What goes into a key" })).toBeInTheDocument();
    // A slide with a ## heading starts at the top, not in the middle.
    expect(screen.getByRole("heading", { name: "What goes into a key" }).closest("[data-slide-fit]")).not.toHaveClass(
      "my-auto",
    );
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    // The counter is a list of slide titles to jump to.
    fireEvent.change(screen.getByRole("combobox", { name: "Go to slide" }), { target: { value: "2" } });
    expect(screen.getByRole("heading", { name: "Next steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
  });

  it("uses the 16:9 stage when wide and reading-size pages when narrow (a phone held upright)", () => {
    setBoxWidth(900);
    const { unmount } = renderDeckReport();
    const stage = screen.getByTestId("slide-stage");
    // Laid out at 1280x720 and scaled to the 900 px it gets.
    expect(stage).toHaveStyle({ width: "900px", height: `${(720 * 900) / 1280}px` });
    expect(screen.queryByTestId("slide-page")).not.toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();

    setBoxWidth(400);
    renderDeckReport();
    expect(screen.getByTestId("slide-page")).toBeInTheDocument();
    expect(screen.queryByTestId("slide-stage")).not.toBeInTheDocument();
  });

  it("moves between slides with a sideways swipe but not a vertical scroll", () => {
    setBoxWidth(400);
    renderDeckReport();
    const stepper = screen.getByTestId("slide-stepper");
    const swipe = (from: [number, number], to: [number, number]) => {
      fireEvent.touchStart(stepper, { touches: [{ clientX: from[0], clientY: from[1] }] });
      fireEvent.touchEnd(stepper, { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
    };
    swipe([300, 300], [100, 310]);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    swipe([200, 400], [190, 100]);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    swipe([100, 300], [300, 290]);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("presents over the whole screen with keyboard navigation, and Escape returns to the card", () => {
    setBoxWidth(1200);
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: requestFullscreen,
      configurable: true,
    });
    renderDeckReport();
    fireEvent.click(screen.getByTestId("present-button"));
    const presenter = screen.getByTestId("slide-presenter");
    expect(requestFullscreen).toHaveBeenCalled();
    expect(within(presenter).getByRole("heading", { name: "Cache walkthrough" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(presenter).getByRole("heading", { name: "What goes into a key" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "End" });
    expect(within(presenter).getByRole("heading", { name: "Next steps" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: " " });
    expect(within(presenter).getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Home" });
    expect(within(presenter).getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("slide-presenter")).not.toBeInTheDocument();
    // The card stays on the slide the presentation ended on.
    expect(within(screen.getByTestId("slide-deck-card")).getByText("2 / 3")).toBeInTheDocument();
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it("offers the deck's exports, PDF first, in its More menu", () => {
    setBoxWidth(900);
    renderDeckReport();
    fireEvent.click(screen.getByTestId("card-more-menu"));
    expect(screen.getByText("Copy Markdown")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Export"));
    const labels = ["PDF (.pdf)", "Markdown (.md)", "Web page (.html)"];
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
    // A deck has no single long picture to export.
    expect(screen.queryByText("Image (.png)")).not.toBeInTheDocument();
  });
});

describe("slide decks in the Library", () => {
  it("shows a deck version as slides under the viewer's own title", () => {
    setBoxWidth(900);
    render(
      <ArtifactVersionContentView
        content={{ kind: "report", markdown: DECK, sourcePath: "/project/reports/cache.md" }}
        title="Cache walkthrough"
        renderMarkdown={(text) => <MarkdownContent text={text} />}
      />,
    );
    const card = screen.getByTestId("slide-deck-card");
    expect(within(card).getByText("3 slides")).toBeInTheDocument();
    expect(screen.getByTestId("slide-stage")).toBeInTheDocument();
    expect(screen.getByTestId("present-button")).toBeInTheDocument();
  });

  it("keeps an ordinary report as one document", () => {
    render(
      <ArtifactVersionContentView
        content={{ kind: "report", markdown: "# Report\n\n---\n\n## Part two", sourcePath: "/r.md" }}
        renderMarkdown={(text) => <MarkdownContent text={text} />}
      />,
    );
    expect(screen.queryByTestId("slide-deck-card")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Part two" })).toBeInTheDocument();
  });
});
