// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMarkdownReportFixture } from "../../../shared/test-fixtures/markdown-report.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { ArtifactVersionContentView } from "../ArtifactInline.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MessageBubble } from "../MessageBubble.js";
import { useStore } from "../../store.js";
import { goToPlayedSlide, stopReadAloud, useReadAloudState } from "../../read-aloud-player.js";

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

/** The same deck written script first: what each slide shows, then its speaker notes. */
const DECK_WITH_NOTES = [
  "---",
  "slides: true",
  "---",
  "",
  "# Cache walkthrough",
  "",
  "Notes:",
  "",
  "Today: what we cache and why.",
  "",
  "---",
  "",
  "## What goes into a key",
  "",
  "File contents, not timestamps.",
  "",
  "Notes:",
  "",
  "Timestamps change on every checkout, so keys built from them never match.",
  "",
  "---",
  "",
  "## Next steps",
].join("\n");

/** The deck published as a report and shown the way the conversation shows it. */
function renderDeckReport(content = DECK) {
  const report = { ...makeMarkdownReportFixture(), content };
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

describe("speaker notes, comments and Play", () => {
  it("shows a slide's notes below it, not on the slide", () => {
    setBoxWidth(900);
    renderDeckReport(DECK_WITH_NOTES);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    const notes = screen.getByTestId("slide-notes");
    expect(notes).toHaveTextContent("Timestamps change on every checkout");
    expect(screen.getByTestId("slide-stage")).not.toHaveTextContent("Timestamps");
    // A slide without notes shows none.
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.queryByTestId("slide-notes")).not.toBeInTheDocument();
  });

  it("comments on a whole slide, naming the slide and the report", () => {
    setBoxWidth(900);
    useStore.getState().setAnnotationEditor(null);
    renderDeckReport(DECK_WITH_NOTES);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    fireEvent.click(screen.getByRole("button", { name: "Comment on slide 2" }));
    const editor = useStore.getState().annotationEditor;
    expect(editor?.annotation).toMatchObject({
      selectedText: "What goes into a key",
      comment: "",
      reportSource: { sourcePath: makeMarkdownReportFixture().source.sourcePath },
      slide: { number: 2, title: "What goes into a key", whole: true },
    });
    useStore.getState().setAnnotationEditor(null);
  });

  it("Play presents the deck reading each slide's notes, the deck follows the reading, and Close ends it", () => {
    // The request never answers here: what matters is what is asked for and how the deck follows.
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    setBoxWidth(1200);
    const report = makeMarkdownReportFixture();
    renderDeckReport(DECK_WITH_NOTES);
    const reading = () => {
      let state: ReturnType<typeof useReadAloudState> = null;
      function Probe() {
        state = useReadAloudState(report.id);
        return null;
      }
      render(<Probe />);
      return state as ReturnType<typeof useReadAloudState>;
    };

    fireEvent.click(screen.getByTestId("play-deck-button"));
    const presenter = screen.getByTestId("slide-presenter");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      messageId: report.id,
      text: "Today: what we cache and why.",
      slide: { shown: "# Cache walkthrough" },
    });
    expect(reading()).toMatchObject({ status: "preparing", slide: { index: 0, count: 3 } });

    // The reading moves on (as when a slide's audio ends): the presentation turns with it.
    act(() => goToPlayedSlide(2));
    expect(within(presenter).getByText("3 / 3")).toBeInTheDocument();
    // A slide without notes is read from its own text.
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({ text: "## Next steps" });

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(reading()).toBeNull();
    stopReadAloud();
  });

  it("shows notes in Present when asked, and remembers it", () => {
    setBoxWidth(1200);
    localStorage.removeItem("cc-slide-presenter-notes");
    renderDeckReport(DECK_WITH_NOTES);
    fireEvent.click(screen.getByTestId("present-button"));
    const presenter = screen.getByTestId("slide-presenter");
    expect(within(presenter).queryByTestId("slide-notes")).not.toBeInTheDocument();
    fireEvent.click(within(presenter).getByTestId("slide-notes-toggle"));
    expect(within(presenter).getByTestId("slide-notes")).toHaveTextContent("Today: what we cache and why.");
    expect(localStorage.getItem("cc-slide-presenter-notes")).toBe("1");
    localStorage.removeItem("cc-slide-presenter-notes");
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
