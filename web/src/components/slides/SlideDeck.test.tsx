// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMarkdownReportFixture } from "../../../shared/test-fixtures/markdown-report.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { ArtifactVersionContentView } from "../ArtifactInline.js";
import { SlideView, useElementWidth } from "./SlideDeck.js";
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
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(within(presenter).getByText("2 / 3")).toBeInTheDocument();
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

  it("turns to the next slide on a click and the previous one on a right-click, without the browser's menu", () => {
    setBoxWidth(900);
    renderDeckReport();
    const stepper = screen.getByTestId("slide-stepper");
    fireEvent.click(screen.getByRole("heading", { name: "Cache walkthrough" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    // A right-click goes back and keeps the browser's own menu away.
    const rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole("heading", { name: "What goes into a key" }).dispatchEvent(rightClick);
    });
    expect(rightClick.defaultPrevented).toBe(true);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    // A click that extends a selection stays the browser's.
    fireEvent.click(stepper, { shiftKey: true });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("leaves clicks on links and code, and clicks that end a text selection, to themselves", () => {
    setBoxWidth(900);
    renderDeckReport(
      DECK.replace("File contents, not timestamps.", "File contents, see `hash()` and [the doc](https://example.com)."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    fireEvent.click(screen.getByText("hash()"));
    fireEvent.click(screen.getByRole("link", { name: "the doc" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    // Text selected on the slide (for a comment or a copy): the click that ends the drag doesn't turn it.
    const paragraph = screen.getByText(/File contents/);
    const selection = window.getSelection()!;
    selection.selectAllChildren(paragraph);
    fireEvent.click(paragraph);
    const rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    paragraph.dispatchEvent(rightClick);
    expect(rightClick.defaultPrevented).toBe(false);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    selection.removeAllRanges();
  });

  it("on a touch screen, a tap on the slide's left third goes back and elsewhere goes on", () => {
    setBoxWidth(400);
    renderDeckReport();
    const stepper = screen.getByTestId("slide-stepper");
    vi.spyOn(stepper, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
    const tap = (clientX: number) => {
      fireEvent.pointerDown(stepper, { pointerType: "touch", clientX });
      fireEvent.click(stepper, { clientX });
    };
    tap(250);
    tap(150);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    tap(50);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("takes the arrow keys once the deck is clicked, and leaves the feed's keys alone before", () => {
    setBoxWidth(900);
    renderDeckReport();
    // Before, the keys belong to the page.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    const deck = screen.getByTestId("slide-stepper").parentElement!;
    fireEvent.keyDown(deck, { key: "ArrowRight" });
    fireEvent.keyDown(deck, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(deck, { key: "ArrowLeft" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    // Up and down still scroll the conversation.
    fireEvent.keyDown(deck, { key: "ArrowDown" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("offers Download and the deck's exports, PDF first, in its More menu", () => {
    setBoxWidth(900);
    renderDeckReport();
    fireEvent.click(screen.getByTestId("card-more-menu"));
    expect(screen.getByText("Copy Markdown")).toBeInTheDocument();
    expect(screen.getByText("Download (.md)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Export"));
    const labels = ["PDF (.pdf)", "Web page (.html)"];
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

  it("Play reads each slide's notes right in the card, the deck follows the reading, and full screen keeps it going", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Play: read each slide aloud" }));
    // It plays where the deck is: nothing goes full screen.
    expect(screen.queryByTestId("slide-presenter")).not.toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      messageId: report.id,
      text: "Today: what we cache and why.",
      slide: { shown: "# Cache walkthrough" },
    });
    expect(reading()).toMatchObject({ status: "preparing", slide: { index: 0, count: 3 } });

    // The reading moves on (as when a slide's audio ends): the card turns with it.
    act(() => goToPlayedSlide(2));
    const card = screen.getByTestId("slide-deck-card");
    expect(within(card).getByText("3 / 3")).toBeInTheDocument();
    // A slide without notes is read from its own text.
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({ text: "## Next steps" });

    // Full screen and back keep reading.
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const presenter = screen.getByTestId("slide-presenter");
    expect(within(presenter).getByText("3 / 3")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("slide-presenter")).not.toBeInTheDocument();
    expect(reading()).toMatchObject({ slide: { index: 2 } });
    stopReadAloud();
  });

  it("Space starts the reading, in the card once clicked and in full screen", () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    setBoxWidth(1200);
    renderDeckReport(DECK_WITH_NOTES);
    const deck = screen.getByTestId("slide-stepper").parentElement!;
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      deck.dispatchEvent(space);
    });
    // Taken, so the conversation doesn't scroll, and the deck is read from the slide shown.
    expect(space.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    stopReadAloud();

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({
      slide: { shown: "## What goes into a key\n\nFile contents, not timestamps." },
    });
    stopReadAloud();
  });

  it("shows notes in Present when asked, and remembers it", () => {
    setBoxWidth(1200);
    localStorage.removeItem("cc-slide-presenter-notes");
    renderDeckReport(DECK_WITH_NOTES);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
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

describe("fitting a slide to the stage", () => {
  // A slide too tall for the stage zooms down until it fits. Its height does not shrink smoothly
  // with the zoom: a smaller zoom lays the text out wider, so a line can unwrap or a code block
  // lose its scrollbar at one step. Here the content is 800 tall at zooms above 0.8 and 700 at or
  // below it, and the box is 600. Refitting from the current zoom swung between 0.75 and 0.86 on
  // every resize report (the flicker); the fit must settle on 0.8, the largest zoom that fits.
  it("settles on one zoom when the content's height jumps between zooms", () => {
    let report: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "slide-stage-box") return { height: 600 } as DOMRect;
      const zoom = Number(this.style.zoom || 1);
      return { height: zoom * (zoom > 0.8 ? 800 : 700) } as DOMRect;
    });

    render(
      <SlideView
        slide={{ markdown: "## Two code blocks", notes: "", title: "Two code blocks" }}
        layout="stage"
        width={1280}
        render={(markdown) => <p>{markdown}</p>}
      />,
    );
    const content = screen.getByText("## Two code blocks").closest("[data-slide-fit]") as HTMLElement;
    expect(content).toHaveAttribute("data-slide-fit", "0.8");

    // Every later size report (the zoom just set, an image arriving) keeps the same zoom.
    for (let i = 0; i < 4; i += 1) {
      act(() => report());
      expect(content).toHaveAttribute("data-slide-fit", "0.8");
      expect(content.style.zoom).toBe("0.8");
    }
  });

  // A visual's frame lays out again after the zoom changes and reports its new height later, so
  // each fit measures it at the zoom just left. Jiayi's "Open questions" slide (a kit table) flipped
  // between two sizes for ever: at zoom 1 the table wrapped and the slide was too tall, so it zoomed
  // out; there the table unwrapped and got shorter, so the next fit grew back to 1, and so on. Here
  // the visual is 400 tall when laid out at zooms above 0.85 and 250 at or below, above 300 of text,
  // in a 600 box. The slide must settle on 0.85 (where everything fits) and stay there.
  it("settles when a visual reports its height for the zoom the slide just left", () => {
    let observerCallback: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let visualLaidOutAt = 1;
    const visualHeight = () => (visualLaidOutAt > 0.85 ? 400 : 250);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "slide-stage-box") return { height: 600 } as DOMRect;
      const zoom = Number(this.style.zoom || 1);
      return { height: zoom * (300 + visualHeight()) } as DOMRect;
    });

    render(
      <SlideView
        slide={{ markdown: "## Open questions", notes: "", title: "Open questions" }}
        layout="stage"
        width={1280}
        render={(markdown) => <p>{markdown}</p>}
      />,
    );
    const content = screen.getByText("## Open questions").closest("[data-slide-fit]") as HTMLElement;
    const zooms: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      // The frame lays out at the zoom now applied and reports its height: a resize, then a fit.
      visualLaidOutAt = Number(content.style.zoom);
      act(() => observerCallback());
      zooms.push(content.style.zoom);
    }
    // At most one trip back up to try the full size, then the same zoom on every later report.
    expect(zooms.slice(2)).toEqual(Array(6).fill("0.85"));
    expect(content).toHaveAttribute("data-slide-fit", "0.85");
  });
});

describe("sizing a deck to its column", () => {
  // The stage takes the width of the deck's box, and its height follows. In a column that
  // scrolls, a slide (with its notes) that just fits brings up the column's scrollbar, which
  // narrows the box; the narrower slide then fits, the scrollbar goes and the box widens again,
  // every frame (the Nov 9 flicker). Here the box is 800 wide without the scrollbar and 785 with
  // it, and the scrollbar shows whenever the deck was sized 800 or wider. The width must settle on
  // 785 and stay there, while a change of the column's own width still resizes the deck.
  it("settles when its own size brings up the column's scrollbar, and follows the column", () => {
    let observerCallback: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let columnWidth = 815;
    let sizedTo = 0;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => columnWidth);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid !== "deck-box") return 0;
      return sizedTo >= columnWidth - 15 ? columnWidth - 30 : columnWidth - 15;
    });
    function Deck() {
      const [ref, width] = useElementWidth<HTMLDivElement>();
      sizedTo = width;
      return <div ref={ref} data-testid="deck-box" data-width={width} />;
    }

    render(
      <div style={{ overflowY: "auto" }}>
        <Deck />
      </div>,
    );
    const box = screen.getByTestId("deck-box");
    const widths: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      act(() => observerCallback());
      widths.push(box.dataset.width!);
    }
    expect(widths.slice(1)).toEqual(Array(5).fill("785"));

    // Closing a side chat widens the column itself: the deck follows.
    columnWidth = 1015;
    act(() => observerCallback());
    expect(box).toHaveAttribute("data-width", "1000");
  });
});
