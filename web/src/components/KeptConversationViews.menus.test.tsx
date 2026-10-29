// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { KeptConversationViews } from "./KeptConversationViews.js";
import { ContextMenu } from "./ContextMenu.js";
import { FullScreenPanel } from "./FullScreenPanel.js";
import { SelectionContextMenu } from "./SelectionContextMenu.js";
import { useTextSelection } from "../hooks/useTextSelection.js";

// Menus and panels are portaled to document.body, outside their conversation's hidden Activity,
// which hides only the conversation's own DOM and turns off its effects. A selection menu left
// open in a chat the user switched away from (by a keyboard shortcut or a notification, with no
// press to close it first) stayed on top of the next chat with its outside-press and Escape
// listeners off, so nothing closed it, and selecting text there showed a second menu.

function KeptChats({ visible, view }: { visible: "a" | "b"; view: ReactNode }) {
  return (
    <KeptConversationViews
      conversations={[
        { sessionId: "a", view },
        { sessionId: "b", view: <p>Other chat</p> },
      ]}
      visibleSessionId={visible}
    />
  );
}

/** A feed's selection wiring, as in MessageFeed: the hook plus its menu. */
function SelectableFeed() {
  const containerRef = useRef<HTMLDivElement>(null);
  const selection = useTextSelection(containerRef);
  return (
    <div ref={containerRef} data-testid="feed">
      <div data-message-id="m1" data-message-role="assistant">
        <span data-chat-selection-scope="true" data-testid="assistant-text">
          Selected assistant text
        </span>
      </div>
      <SelectionContextMenu selection={selection} sessionId="a" onClose={selection.dismiss} />
    </div>
  );
}

/** jsdom has no layout, so the selection is a stand-in over the assistant text with a fixed rect. */
function selectAssistantText() {
  const textNode = screen.getByTestId("assistant-text").firstChild!;
  const range = document.createRange();
  range.selectNodeContents(textNode);
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 40, top: 200, right: 220, bottom: 220, width: 180, height: 20 }) as DOMRect,
  });
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: textNode,
    focusNode: textNode,
    toString: () => "Selected assistant text",
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  } as unknown as Selection);
  fireEvent.mouseDown(screen.getByTestId("feed"));
  act(() => {
    fireEvent.mouseUp(document);
  });
}

const openMenus = () => document.querySelectorAll("[data-context-menu]");

describe("pop-ups of kept conversations", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes the selection menu when its conversation is hidden, and keeps it closed on return", () => {
    const view = render(<KeptChats visible="a" view={<SelectableFeed />} />);
    selectAssistantText();
    expect(openMenus()).toHaveLength(1);

    view.rerender(<KeptChats visible="b" view={<SelectableFeed />} />);
    expect(openMenus()).toHaveLength(0);

    // The menu must not come back with the conversation: the selection it was for is long gone
    // from the user's mind, and its listeners were off meanwhile.
    view.rerender(<KeptChats visible="a" view={<SelectableFeed />} />);
    expect(openMenus()).toHaveLength(0);

    // Back on screen, the feed listens again and offers its menu for a new selection. (Activity
    // detaches refs while hidden; a hook that read its container during a hidden render came
    // back with none.)
    selectAssistantText();
    expect(openMenus()).toHaveLength(1);
  });

  it("hides any context menu left open in a hidden conversation", () => {
    const menu = <ContextMenu x={10} y={10} items={[{ label: "Copy", onClick: () => {} }]} onClose={() => {}} />;
    const view = render(<KeptChats visible="a" view={menu} />);
    expect(openMenus()).toHaveLength(1);

    view.rerender(<KeptChats visible="b" view={menu} />);
    expect(openMenus()).toHaveLength(0);
  });

  it("hides a full-screen panel while its conversation is hidden", () => {
    const panel = (
      <FullScreenPanel title="Report" onClose={() => {}}>
        <p>Report body</p>
      </FullScreenPanel>
    );
    const view = render(<KeptChats visible="a" view={panel} />);
    expect(screen.getByTestId("full-screen-panel")).toBeInTheDocument();

    view.rerender(<KeptChats visible="b" view={panel} />);
    expect(screen.queryByTestId("full-screen-panel")).toBeNull();

    view.rerender(<KeptChats visible="a" view={panel} />);
    expect(screen.getByTestId("full-screen-panel")).toBeInTheDocument();
  });
});
