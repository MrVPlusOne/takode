// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));
const topicsOn = vi.hoisted(() => ({ value: false }));
vi.mock("../utils/leader-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/leader-topics.js")>()),
  useLeaderTopicsOn: () => topicsOn.value,
}));

import { useStore } from "../store.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { markLeaderThreadDisplayed } from "../utils/thread-viewport.js";
import { newSideChatDraftKey } from "./side-column/NewSideChat.js";
import { SelectionContextMenu } from "./SelectionContextMenu.js";
import { ComposerTargetContext } from "./composer-target.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";

const written: Array<Record<string, string>> = [];
const originalClipboardItem = globalThis.ClipboardItem;

beforeEach(() => {
  written.length = 0;
  (globalThis as any).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
      write: vi.fn(async ([item]: Array<{ items: Record<string, Blob> }>) => {
        const out: Record<string, string> = {};
        for (const [type, blob] of Object.entries(item!.items)) out[type] = await blob.text();
        written.push(out);
      }),
    },
  });
});

afterEach(() => {
  (globalThis as any).ClipboardItem = originalClipboardItem;
  topicsOn.value = false;
});

describe("selection Copy menu", () => {
  it("copies a selection for Slack with its formatting in Slack's terms", async () => {
    // A selection inside a message gets the same Slack-friendly copy as the whole message.
    const message = document.createElement("div");
    message.innerHTML = '<h2 class="text-lg">Title</h2><p>Run is <strong class="font-semibold">healthy</strong>.</p>';
    document.body.appendChild(message);
    const range = document.createRange();
    range.selectNodeContents(message);
    const onClose = vi.fn();
    render(
      <SelectionContextMenu
        sessionId="s1"
        onClose={onClose}
        selection={{
          isActive: true,
          plainText: "Title Run is healthy.",
          range,
          position: { x: 10, y: 10 },
          clear: vi.fn(),
          dismiss: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "For Slack" }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/html"]).toBe("<p><b>Title</b></p><p>Run is <b>healthy</b>.</p>");
    expect(onClose).toHaveBeenCalled();
    message.remove();
  });
  it("shows the copy formats in the menu when Copy is tapped", async () => {
    // On a phone, tapping Copy expands the formats inside the menu, then a tap
    // on one copies it and closes the menu.
    const message = document.createElement("p");
    message.textContent = "Plain words";
    document.body.appendChild(message);
    const range = document.createRange();
    range.selectNodeContents(message);
    const onClose = vi.fn();
    render(
      <SelectionContextMenu
        sessionId="s1"
        onClose={onClose}
        selection={{
          isActive: true,
          plainText: "Plain words",
          range,
          position: { x: 10, y: 10 },
          clear: vi.fn(),
          dismiss: vi.fn(),
        }}
      />,
    );

    fingerTap(screen.getByRole("button", { name: "Copy" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("context-submenu-inline").contains(screen.getByRole("button", { name: "Plain text" })),
    ).toBe(true);
    fingerTap(screen.getByRole("button", { name: "Plain text" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Plain words");
    expect(onClose).toHaveBeenCalled();
    message.remove();
  });
});

describe("Ask in side chat", () => {
  it("opens a new side chat about the thread on screen, with the passage in its message box", () => {
    // Only leaders with topics on have side chats.
    topicsOn.value = true;
    const shown = markLeaderThreadDisplayed("s1", "q-7");
    const message = document.createElement("p");
    message.textContent = "A passage";
    document.body.appendChild(message);
    const range = document.createRange();
    range.selectNodeContents(message);
    const clear = vi.fn();
    const onClose = vi.fn();
    try {
      render(
        <SelectionContextMenu
          sessionId="s1"
          onClose={onClose}
          selection={{
            isActive: true,
            plainText: "A passage",
            range,
            position: { x: 10, y: 10 },
            clear,
            dismiss: vi.fn(),
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ask in side chat" }));

      const [item] = useSideColumnStore.getState().columns.s1!.items;
      expect(item).toEqual(expect.objectContaining({ kind: "new-chat", startedFrom: "q-7" }));
      const draft = useStore.getState().composerDrafts.get(newSideChatDraftKey("s1"));
      expect(draft?.annotations).toEqual([expect.objectContaining({ selectedText: "A passage", comment: "" })]);
      // The main message box is left as it was.
      expect(useStore.getState().composerDrafts.get("s1")).toBeUndefined();
      expect(clear).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    } finally {
      shown();
      message.remove();
      useSideColumnStore.setState({ columns: {} });
      localStorage.clear();
    }
  });
});

describe("Comment", () => {
  it("opens the editor for the composer of the conversation the passage is in", () => {
    // A passage in a side chat's feed comments into the side chat's composer; one in the main feed
    // (no provider) into the session's main composer.
    const message = document.createElement("p");
    message.textContent = "A passage";
    document.body.appendChild(message);
    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = {
      isActive: true,
      plainText: "A passage",
      range,
      position: { x: 10, y: 10 },
      clear: vi.fn(),
      dismiss: vi.fn(),
    };
    try {
      const view = render(<SelectionContextMenu sessionId="s1" onClose={vi.fn()} selection={selection} />);
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      expect(useStore.getState().annotationEditor).toEqual(
        expect.objectContaining({ sessionId: "s1", draftKey: "s1" }),
      );
      view.unmount();

      render(
        <ComposerTargetContext.Provider value="s1#side:topic:aaaa0001">
          <SelectionContextMenu sessionId="s1" onClose={vi.fn()} selection={selection} />
        </ComposerTargetContext.Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      expect(useStore.getState().annotationEditor?.draftKey).toBe("s1#side:topic:aaaa0001");
    } finally {
      message.remove();
      useStore.getState().setAnnotationEditor(null);
    }
  });
});
