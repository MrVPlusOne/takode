// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextSelection } from "./useTextSelection.js";

const FULL_SELECTION_TEXT = [
  "Yes. The leader conflated three visually similar boundaries:",
  "Normal context compaction.",
  "Intentional approval pauses.",
  "One genuine transport interruption.",
].join("\n");

const SELECTION_RECT = {
  left: 40,
  top: 120,
  right: 420,
  bottom: 260,
  width: 380,
  height: 140,
  x: 40,
  y: 120,
  toJSON: () => ({}),
} as DOMRect;

function RangeSelectionHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionWrapperRef = useRef<HTMLDivElement>(null);
  const selectionScopeRef = useRef<HTMLDivElement>(null);
  const [, setMounted] = useState(false);
  const selection = useTextSelection(containerRef);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div ref={containerRef} data-testid="container">
      <div data-testid="outside-text">Composer and control text must stay outside the menu scope.</div>
      <div data-testid="message-shell" data-message-id="message-1" data-message-role="assistant">
        <div ref={selectionWrapperRef} data-testid="selection-wrapper">
          {"\n  "}
          <button type="button" data-testid="boundary-icon" aria-label="Message options">
            <svg aria-hidden="true" />
          </button>
          <div ref={selectionScopeRef} data-testid="selection-scope" data-chat-selection-scope="true">
            <p data-testid="intro">
              Yes. The leader conflated three visually <strong data-testid="strong">similar</strong> boundaries:
            </p>
            <ul data-testid="list">
              <li data-testid="item-1">
                Normal <em data-testid="emphasis">context</em> compaction.
              </li>
              <li data-testid="item-2">
                Intentional <code data-testid="inline-code">approval</code> pauses.
              </li>
              <li data-testid="item-3">
                One genuine{" "}
                <a data-testid="link" href="https://example.com/transport">
                  transport interruption
                </a>
                .
              </li>
            </ul>
          </div>
          <img data-testid="boundary-image" src="/boundary-preview.png" alt="Boundary preview" />
          {"\n  "}
        </div>
        <div data-testid="message-control">Message options · 4:56 PM</div>
        <div data-testid="same-message-second-scope" data-chat-selection-scope="true">
          <p data-testid="same-message-second-text">Later assistant content block.</p>
        </div>
      </div>
      <div data-message-id="message-2" data-message-role="assistant">
        <div data-testid="second-scope" data-chat-selection-scope="true">
          <p data-testid="second-message">Second assistant message.</p>
        </div>
      </div>
      <div data-testid="selection-active">{selection.isActive ? "true" : "false"}</div>
      <div data-testid="selection-text">{selection.plainText}</div>
      <div data-testid="selection-position">
        {selection.position ? `${selection.position.x},${selection.position.y}` : "none"}
      </div>
      <div data-testid="selection-range">
        {selection.range
          ? `${selection.range.startContainer === selectionScopeRef.current}:${selection.range.startOffset}|${selection.range.endContainer === selectionScopeRef.current}:${selection.range.endOffset}`
          : "none"}
      </div>
    </div>
  );
}

function setRangeRect(range: Range, rect: DOMRect = SELECTION_RECT): void {
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function installSelection({
  range,
  text = range.toString(),
  anchorNode = range.startContainer,
  focusNode = range.endContainer,
  rangeCount = 1,
}: {
  range: Range;
  text?: string;
  anchorNode?: Node | null;
  focusNode?: Node | null;
  rangeCount?: number;
}) {
  setRangeRect(range);
  const removeAllRanges = vi.fn();
  const selection = {
    isCollapsed: false,
    rangeCount,
    anchorNode,
    focusNode,
    toString: () => text,
    getRangeAt: () => range,
    removeAllRanges,
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(selection);
  return { removeAllRanges };
}

function finishMouseSelection(): void {
  fireEvent.mouseDown(screen.getByTestId("container"));
  act(() => {
    fireEvent.mouseUp(document);
  });
}

function fullMessageRange(): { range: Range; shell: HTMLElement } {
  const shell = screen.getByTestId("selection-wrapper");
  const range = document.createRange();
  range.setStart(shell, 0);
  range.setEnd(shell, shell.childNodes.length);
  return { range, shell };
}

function expectActiveSelection(text: string): void {
  expect(screen.getByTestId("selection-active").textContent).toBe("true");
  expect(screen.getByTestId("selection-text").textContent).toBe(text);
  expect(screen.getByTestId("selection-position").textContent).not.toBe("none");
}

describe("useTextSelection DOM Range ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // Reproduces the failing screenshot: dragging across every rendered block can
  // leave both Selection endpoints on the message wrapper rather than text nodes.
  it("opens for a complete paragraph-plus-list selection with wrapper endpoints", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    const { removeAllRanges } = installSelection({
      range,
      text: FULL_SELECTION_TEXT,
      anchorNode: shell,
      focusNode: shell,
    });

    finishMouseSelection();

    expectActiveSelection(FULL_SELECTION_TEXT);
    const scope = screen.getByTestId("selection-scope");
    expect(screen.getByTestId("selection-range").textContent).toBe(`true:0|true:${scope.childNodes.length}`);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  // Reverse dragging exposes the same canonical Range with anchor/focus at the
  // opposite outer whitespace edges; ownership must not depend on drag direction.
  it("opens for the same cross-block selection dragged in reverse", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    const { removeAllRanges } = installSelection({
      range,
      text: FULL_SELECTION_TEXT,
      anchorNode: shell.lastChild,
      focusNode: shell.firstChild,
    });

    finishMouseSelection();

    expectActiveSelection(FULL_SELECTION_TEXT);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  // Browsers can canonicalize only one side of a drag to the outer wrapper.
  // The fallback must use the Range even when the other endpoint already resolves.
  it("opens when only one Selection endpoint moves outside the scope", () => {
    render(<RangeSelectionHarness />);
    const wrapper = screen.getByTestId("selection-wrapper");
    const introText = screen.getByTestId("intro").firstChild;
    if (!introText) throw new Error("Missing mixed-boundary text node");
    const range = document.createRange();
    range.setStart(introText, 5);
    range.setEnd(wrapper, wrapper.childNodes.length);
    const text = `The leader conflated three visually similar boundaries:
${FULL_SELECTION_TEXT.split("\n").slice(1).join("\n")}`;
    installSelection({ range, text, anchorNode: introText, focusNode: wrapper });

    finishMouseSelection();

    expectActiveSelection(text);
  });

  // Whole-list selection often reports UL/LI element boundaries instead of the
  // descendant text nodes used by the earlier partial-selection tests.
  it("opens for complete list items selected by element offsets", () => {
    render(<RangeSelectionHarness />);
    const list = screen.getByTestId("list");
    const range = document.createRange();
    range.setStart(list, 0);
    range.setEnd(list, list.childNodes.length);
    const text = "Normal context compaction.\nIntentional approval pauses.\nOne genuine transport interruption.";
    const { removeAllRanges } = installSelection({ range, text, anchorNode: list, focusNode: list });

    finishMouseSelection();

    expectActiveSelection(text);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  // Inline markup must remain eligible without special-casing each rendered tag.
  it("opens across formatted text, inline code, and a link", () => {
    render(<RangeSelectionHarness />);
    const strong = screen.getByTestId("strong");
    const link = screen.getByTestId("link");
    const range = document.createRange();
    range.setStart(strong, 0);
    range.setEnd(link, link.childNodes.length);
    const text =
      "similar boundaries:\nNormal context compaction.\nIntentional approval pauses.\nOne genuine transport interruption";
    installSelection({ range, text, anchorNode: strong, focusNode: link });

    finishMouseSelection();

    expectActiveSelection(text);
  });

  // This is the screenshot's working control: text-node endpoints already live
  // inside the explicit chat scope and must keep their existing behavior.
  it("keeps partial text-node selections working", () => {
    render(<RangeSelectionHarness />);
    const introText = screen.getByTestId("intro").firstChild;
    const finalLinkText = screen.getByTestId("link").firstChild;
    if (!introText || !finalLinkText) throw new Error("Missing partial-selection text nodes");
    const range = document.createRange();
    range.setStart(introText, 5);
    range.setEnd(finalLinkText, finalLinkText.textContent?.length ?? 0);
    const text = "The leader conflated three visually similar boundaries through transport interruption";
    installSelection({ range, text, anchorNode: introText, focusNode: finalLinkText });

    finishMouseSelection();

    expectActiveSelection(text);
  });

  // Whitespace outside the Markdown root is a boundary artifact, not foreign
  // selected content. The hook should accept it without rewriting plainText.
  it("allows surrounding whitespace edges and preserves selected text exactly", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    const text = `\n${FULL_SELECTION_TEXT}\n`;
    installSelection({ range, text, anchorNode: shell.firstChild, focusNode: shell.lastChild });

    finishMouseSelection();

    expectActiveSelection(text);
  });

  // Separate Markdown roots in one assistant message are separate eligibility
  // scopes; crossing a tool/quiz/control seam must not inherit message ownership.
  it("rejects a selection spanning two scopes in the same assistant message", () => {
    render(<RangeSelectionHarness />);
    const introText = screen.getByTestId("intro").firstChild;
    const laterText = screen.getByTestId("same-message-second-text").firstChild;
    if (!introText || !laterText) throw new Error("Missing same-message scope nodes");
    const range = document.createRange();
    range.setStart(introText, 0);
    range.setEnd(laterText, laterText.textContent?.length ?? 0);
    installSelection({ range, anchorNode: introText, focusNode: laterText });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // A message wrapper contains action/timestamp text outside Markdown. Selecting
  // that sibling together with the response must remain ineligible.
  it("rejects same-message control text selected with scoped Markdown", () => {
    render(<RangeSelectionHarness />);
    const introText = screen.getByTestId("intro").firstChild;
    const controlText = screen.getByTestId("message-control").firstChild;
    if (!introText || !controlText) throw new Error("Missing same-message control nodes");
    const range = document.createRange();
    range.setStart(introText, 0);
    range.setEnd(controlText, controlText.textContent?.length ?? 0);
    installSelection({ range, anchorNode: introText, focusNode: controlText });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // Selection ownership is still message-local: a Range spanning two otherwise
  // eligible assistant Markdown roots must not activate Takode's menu.
  it("rejects a selection spanning two assistant messages", () => {
    render(<RangeSelectionHarness />);
    const introText = screen.getByTestId("intro").firstChild;
    const secondText = screen.getByTestId("second-message").firstChild;
    if (!introText || !secondText) throw new Error("Missing cross-message text nodes");
    const range = document.createRange();
    range.setStart(introText, 0);
    range.setEnd(secondText, secondText.textContent?.length ?? 0);
    const { removeAllRanges } = installSelection({ range, anchorNode: introText, focusNode: secondText });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  // A wrapper-edge fallback must not accidentally legitimize composer, control,
  // or other non-chat text selected together with an assistant response.
  it("rejects non-chat text selected alongside an eligible message", () => {
    render(<RangeSelectionHarness />);
    const outsideText = screen.getByTestId("outside-text").firstChild;
    const finalLinkText = screen.getByTestId("link").firstChild;
    if (!outsideText || !finalLinkText) throw new Error("Missing mixed-surface text nodes");
    const range = document.createRange();
    range.setStart(outsideText, 0);
    range.setEnd(finalLinkText, finalLinkText.textContent?.length ?? 0);
    installSelection({ range, anchorNode: outsideText, focusNode: finalLinkText });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // Delayed evaluation can also observe a connected Selection whose Range APIs
  // become stale during a render; ownership must fail closed without throwing.
  it("ignores a Range that becomes stale during scope intersection", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    vi.spyOn(range, "intersectsNode").mockImplementation(() => {
      throw new DOMException("Range is stale");
    });
    installSelection({ range, text: FULL_SELECTION_TEXT, anchorNode: shell, focusNode: shell });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // Discontiguous browser selections would otherwise combine Selection text
  // with only Range 0 for ownership/copy, so the custom menu fails closed.
  it("rejects selections with multiple Ranges", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    installSelection({ range, text: FULL_SELECTION_TEXT, anchorNode: shell, focusNode: shell, rangeCount: 2 });

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // Touch/RAF evaluation can race with a message rerender. Detached boundary
  // nodes should fail closed instead of throwing or reviving stale menu state.
  it("ignores a detached wrapper-boundary Range", () => {
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    installSelection({ range, text: FULL_SELECTION_TEXT, anchorNode: shell, focusNode: shell });
    shell.remove();

    finishMouseSelection();

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
  });

  // Touch uses the same block-boundary ownership but retains the native DOM
  // selection and keeps the fixed-position menu inside a narrow viewport.
  it("keeps a full-block touch selection and its menu within viewport bounds", () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    render(<RangeSelectionHarness />);
    const { range, shell } = fullMessageRange();
    const { removeAllRanges } = installSelection({
      range,
      text: FULL_SELECTION_TEXT,
      anchorNode: shell,
      focusNode: shell,
    });

    fireEvent.touchStart(screen.getByTestId("container"));
    act(() => {
      fireEvent.touchEnd(document);
      vi.advanceTimersByTime(300);
    });

    expectActiveSelection(FULL_SELECTION_TEXT);
    expect(removeAllRanges).not.toHaveBeenCalled();
    const position = screen.getByTestId("selection-position").textContent;
    const [x, y] = (position ?? "").split(",").map(Number);
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x + 180).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(y).toBeGreaterThanOrEqual(4);
    expect(y + 68).toBeLessThanOrEqual(window.innerHeight - 4);
  });
});
