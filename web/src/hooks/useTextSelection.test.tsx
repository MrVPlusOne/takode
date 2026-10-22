// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useTextSelection } from "./useTextSelection.js";

type MockSelectionState = {
  text: string;
  anchorNode: Node | null;
  focusNode: Node | null;
  rect: DOMRect;
};

function SelectionHarness({
  selectionScope = true,
  messageRole = "assistant",
  mathSelection = false,
}: {
  selectionScope?: boolean;
  messageRole?: "assistant" | "user";
  mathSelection?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setMounted] = useState(false);
  const selection = useTextSelection(containerRef);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div ref={containerRef} data-testid="container">
      <div data-message-id="message-1" data-message-role={messageRole}>
        <span data-testid="selection-scope" data-chat-selection-scope={selectionScope ? "true" : undefined}>
          {mathSelection ? (
            <span data-math-source="\(x^2\)" className="takode-math">
              <span className="katex-mathml">x^2</span>
              <span className="katex-html" aria-hidden="true" data-testid="assistant-text">
                x2
              </span>
            </span>
          ) : (
            <span data-testid="assistant-text">Selected assistant text</span>
          )}
        </span>
      </div>
      <div data-testid="selection-active">{selection.isActive ? "true" : "false"}</div>
      <div data-testid="selection-text">{selection.plainText}</div>
      <div data-testid="selection-position">
        {selection.position ? `${selection.position.x},${selection.position.y}` : "none"}
      </div>
      <button type="button" onClick={selection.dismiss}>
        Dismiss
      </button>
      <button type="button" onClick={selection.clear}>
        Clear
      </button>
    </div>
  );
}

// jsdom selection support is too limited for this hook path, so these tests use
// a controlled mock that lets us model the cloned range and native clear behavior.
function createSelectionMock(state: MockSelectionState) {
  const boundaryNode = state.anchorNode;
  if (!boundaryNode) throw new Error("Selection mock requires an anchor node");
  const range = boundaryNode.ownerDocument?.createRange() ?? document.createRange();
  if (boundaryNode.nodeType === Node.TEXT_NODE && state.focusNode === boundaryNode) {
    range.setStart(boundaryNode, 0);
    range.setEnd(boundaryNode, boundaryNode.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(boundaryNode);
  }
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => state.rect,
  });

  const removeAllRanges = vi.fn(() => {
    state.text = "";
    state.anchorNode = null;
    state.focusNode = null;
  });

  const selection = {
    rangeCount: 1,
    get isCollapsed() {
      return state.text.length === 0;
    },
    get anchorNode() {
      return state.anchorNode;
    },
    get focusNode() {
      return state.focusNode;
    },
    toString: () => state.text,
    getRangeAt: () => range,
    removeAllRanges,
  } as unknown as Selection;

  return { selection, removeAllRanges };
}

describe("useTextSelection", () => {
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

  // Verifies the mobile regression fix: touch selection should keep both the
  // browser DOM selection and Takode's cached menu state alive.
  it("keeps the native DOM selection intact on touch", () => {
    render(<SelectionHarness />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");

    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    const { selection, removeAllRanges } = createSelectionMock(selectionState);
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.touchStart(container);

    act(() => {
      fireEvent.touchEnd(document);
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("true");
    expect(screen.getByTestId("selection-text").textContent).toBe("Selected assistant text");
    const [, menuY] = screen.getByTestId("selection-position").textContent!.split(",").map(Number);
    // Touch actions stay near the selected block rather than docking at the opposite screen edge.
    expect(menuY).toBeLessThanOrEqual(selectionState.rect.bottom + 56);
    expect(menuY + 68).toBeGreaterThanOrEqual(selectionState.rect.top - 56);
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(selectionState.text).toBe("Selected assistant text");
  });

  // iOS puts its own edit menu (Copy, Look Up, Translate) just above a touch
  // selection, and a page cannot hide it for plain text, so Takode's menu goes
  // below the selection past its end handle, or above iOS's menu when there is
  // no room below.
  it("places the touch menu clear of iOS's edit menu above the selection", () => {
    render(<SelectionHarness />);
    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");
    const rectAt = (top: number, bottom: number) =>
      ({
        left: 40,
        top,
        right: 220,
        bottom,
        width: 180,
        height: bottom - top,
        x: 40,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: rectAt(120, 160),
    };
    vi.spyOn(window, "getSelection").mockReturnValue(createSelectionMock(selectionState).selection);
    const touchSelect = () => {
      fireEvent.touchStart(container);
      act(() => {
        fireEvent.touchEnd(document);
        vi.advanceTimersByTime(300);
      });
      return screen.getByTestId("selection-position").textContent!.split(",").map(Number)[1]!;
    };

    // Room below: the menu starts below the selection and its end handle.
    expect(touchSelect()).toBeGreaterThanOrEqual(160 + 24);

    // Near the bottom of the screen (jsdom is 768 px tall): above the selection,
    // leaving iOS's menu its usual slot just above the selected text.
    selectionState.rect = rectAt(600, 700);
    const menuY = touchSelect();
    expect(menuY + 100).toBeLessThanOrEqual(600 - 60);
  });

  // iOS clears the browser selection on any tap, including a tap on Takode's own
  // menu. Tapping the menu's Copy row must leave the menu open for its formats;
  // a press anywhere else still lets a cleared selection close it.
  it("keeps the menu open when a press on it clears the browser selection", () => {
    render(<SelectionHarness />);
    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");
    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    vi.spyOn(window, "getSelection").mockReturnValue(createSelectionMock(selectionState).selection);
    const menu = document.createElement("div");
    menu.dataset.contextMenu = "true";
    const menuRow = document.createElement("button");
    menu.appendChild(menuRow);
    document.body.appendChild(menu);

    try {
      fireEvent.touchStart(container);
      act(() => {
        fireEvent.touchEnd(document);
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("selection-active").textContent).toBe("true");

      // The tap on the menu row, then iOS's selection clear.
      fireEvent.pointerDown(menuRow, { pointerType: "touch" });
      selectionState.text = "";
      act(() => {
        fireEvent.touchEnd(document);
        document.dispatchEvent(new Event("selectionchange"));
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("selection-active").textContent).toBe("true");
      expect(screen.getByTestId("selection-text").textContent).toBe("Selected assistant text");

      fireEvent.pointerDown(document.body, { pointerType: "touch" });
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      expect(screen.getByTestId("selection-active").textContent).toBe("false");
    } finally {
      menu.remove();
    }
  });

  // Non-chat Markdown can be rendered inside overlays while MessageFeed remains
  // mounted. It must not opt into the chat selection menu by accident.
  it("ignores assistant text outside the explicit chat selection scope", () => {
    render(<SelectionHarness selectionScope={false} />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");

    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    const { selection, removeAllRanges } = createSelectionMock(selectionState);
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.touchStart(container);

    act(() => {
      fireEvent.touchEnd(document);
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(selectionState.text).toBe("Selected assistant text");
  });

  // The explicit scope is necessary but not sufficient: user/non-assistant
  // messages should keep normal browser selection without Takode's chat menu.
  it("ignores explicitly scoped text outside assistant messages", () => {
    render(<SelectionHarness messageRole="user" />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing text node");

    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    const { selection, removeAllRanges } = createSelectionMock(selectionState);
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.mouseDown(container);
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(selectionState.text).toBe("Selected assistant text");
  });

  // Verifies the desktop edge case: mouse selection still relies on the live DOM
  // selection and must not trigger the touch-only native-selection dismissal.
  it("preserves the native DOM selection on mouse interactions", () => {
    render(<SelectionHarness />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");

    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    const { selection, removeAllRanges } = createSelectionMock(selectionState);
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.mouseDown(container);
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("true");
    expect(screen.getByTestId("selection-text").textContent).toBe("Selected assistant text");
    expect(selectionState.text).toBe("Selected assistant text");
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it("collapses partial KaTeX selection to one exact source token", () => {
    // KaTeX exposes MathML plus a visual subtree; quote/plain selection must
    // expand to the source wrapper rather than caching duplicated glyph text.
    render(<SelectionHarness mathSelection />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode?.textContent) throw new Error("Missing math visual text node");

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.textContent.length);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () =>
        ({
          left: 40,
          top: 120,
          right: 120,
          bottom: 145,
          width: 80,
          height: 25,
          x: 40,
          y: 120,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      focusNode: textNode,
      toString: () => "x^2x2",
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.mouseDown(container);
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("true");
    expect(screen.getByTestId("selection-text").textContent).toBe("\\(x^2\\)");
  });

  // Dismissing the app menu is intentionally separate from clearing the actual
  // browser selection, so selecting non-chat Markdown after a stale menu is safe.
  it("dismisses Takode's menu without clearing the browser selection", () => {
    render(<SelectionHarness />);

    const container = screen.getByTestId("container");
    const textNode = screen.getByTestId("assistant-text").firstChild;
    if (!textNode) throw new Error("Missing assistant text node");

    const selectionState: MockSelectionState = {
      text: "Selected assistant text",
      anchorNode: textNode,
      focusNode: textNode,
      rect: {
        left: 40,
        top: 120,
        right: 220,
        bottom: 160,
        width: 180,
        height: 40,
        x: 40,
        y: 120,
        toJSON: () => ({}),
      } as DOMRect,
    };
    const { selection, removeAllRanges } = createSelectionMock(selectionState);
    vi.spyOn(window, "getSelection").mockReturnValue(selection);

    fireEvent.mouseDown(container);
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(screen.getByTestId("selection-active").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.getByTestId("selection-active").textContent).toBe("false");
    expect(selectionState.text).toBe("Selected assistant text");
    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});
