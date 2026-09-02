// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, QuestmasterTask } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MessageBubble } from "./MessageBubble.js";

function quest(questId: string, title: string): QuestmasterTask {
  return {
    id: `${questId}-v1`,
    questId,
    version: 1,
    status: "refined",
    title,
    description: "Producer-shaped feed preview fixture",
    createdAt: 1,
  } as QuestmasterTask;
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: "user", content, timestamp: 1 };
}

function assistantMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    contentBlocks: [{ type: "text", text: content }],
    timestamp: 2,
  };
}

const DENSE_FEED_CONTROL_RECTS = [
  DOMRect.fromRect({ x: 488.7, y: 655.3, width: 171.7, height: 23.4 }),
  DOMRect.fromRect({ x: 640.3, y: 689.5, width: 77.5, height: 14.9 }),
  DOMRect.fromRect({ x: 640.3, y: 749.4, width: 77.5, height: 14.8 }),
  DOMRect.fromRect({ x: 521.1, y: 776.8, width: 658.8, height: 23.9 }),
];

function installGeometry() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function getClientRects(this: Element) {
    const element = this as HTMLElement;
    if (element.matches("a.cc-quest-link")) {
      if (element.getAttribute("href")?.includes("quest=q-67")) {
        return [DOMRect.fromRect({ x: 598.9, y: 716.9, width: 44.9, height: 16.2 })] as unknown as DOMRectList;
      }
      return [DOMRect.fromRect({ x: 100, y: 100, width: 90, height: 20 })] as unknown as DOMRectList;
    }
    if (element.dataset.testid === "quest-feed-preview-button") {
      if (element.dataset.questId === "q-67") {
        return [DOMRect.fromRect({ x: 645.6, y: 715.2, width: 23.4, height: 23.4 })] as unknown as DOMRectList;
      }
      return [DOMRect.fromRect({ x: 192, y: 97, width: 26, height: 26 })] as unknown as DOMRectList;
    }
    if (element.dataset.producerNearbyControl?.startsWith("dense-")) {
      const index = Number.parseInt(element.dataset.producerNearbyControl.slice("dense-".length), 10);
      const rect = DENSE_FEED_CONTROL_RECTS[index];
      return (rect ? [rect] : []) as unknown as DOMRectList;
    }
    if (element.dataset.producerNearbyControl === "cover") {
      return [DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 })] as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: Element,
  ) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-title-preview") {
      if (document.querySelector("[data-producer-nearby-control^='dense-']")) {
        return DOMRect.fromRect({ width: 288, height: 47.6 });
      }
      return DOMRect.fromRect({ width: 320, height: 58 });
    }
    if (element.dataset.testid === "quest-feed-rich-preview") {
      return DOMRect.fromRect({ width: 560, height: 300 });
    }
    return DOMRect.fromRect();
  });
}

describe("producer-shaped chat feed quest preview", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ zoomLevel: 1 });
    window.location.hash = "#/session/s1";
    installGeometry();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opts both user and assistant message bodies into the feed-only surface", () => {
    render(
      <div>
        <MessageBubble
          message={userMessage("u1", "User [q-60](quest:q-60)")}
          sessionId="s1"
          questLinkSurface="chat-feed"
        />
        <MessageBubble
          message={assistantMessage("a1", "Assistant [q-61 feedback #2](quest:q-61:feedback:2)")}
          sessionId="s1"
          questLinkSurface="chat-feed"
        />
      </div>,
    );

    expect(screen.getByRole("button", { name: "Preview q-60" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview q-61 feedback #2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-61 feedback #2" })).toHaveAttribute(
      "href",
      "#/session/s1?quest=q-61&feedback=2",
    );
  });

  it("leaves reused non-feed MessageBubble and MarkdownContent callers on legacy behavior", () => {
    render(
      <>
        <MessageBubble message={userMessage("u2", "Side preview [q-62](quest:q-62)")} sessionId="s1" />
        <MarkdownContent text="Relationship [q-63](quest:q-63)" />
      </>,
    );

    expect(screen.queryByRole("button", { name: /Preview q-/ })).toBeNull();
    expect(screen.getByRole("link", { name: "q-62" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-63" })).toBeInTheDocument();
  });

  it("opens and closes both preview layers without replacing or removing stable Markdown nodes", async () => {
    const cached = quest("q-64", "Stable Markdown title");
    useStore.setState({
      questDetails: new Map([["q-64", cached]]),
      questDetailEtags: new Map([["q-64", '"detail-v1"']]),
    });
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"detail-v1"' });
    const { container } = render(
      <MessageBubble
        message={assistantMessage("a2", "Review [q-64](quest:q-64) now.")}
        sessionId="s1"
        questLinkSurface="chat-feed"
      />,
    );
    const markdown = container.querySelector<HTMLElement>(".markdown-body")!;
    const anchor = within(markdown).getByRole("link", { name: "q-64" });
    const removedMarkdownNodes: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node === markdown || (node instanceof Element && node.matches(".markdown-body, .markdown-body *"))) {
            removedMarkdownNodes.push(node);
          }
        }
      }
    });
    observer.observe(markdown, { childList: true, subtree: true });

    fireEvent.focus(anchor);
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preview q-64/ }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "Stable Markdown title" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => Promise.resolve());

    expect(container.querySelector(".markdown-body")).toBe(markdown);
    expect(within(markdown).getByRole("link", { name: "q-64" })).toBe(anchor);
    expect(removedMarkdownNodes).toEqual([]);
    observer.disconnect();
  });

  it("slides fine-pointer text hover around dense transition controls without replacing the native link", async () => {
    vi.useFakeTimers();
    const cached = quest("q-67", "Dense transition hover title");
    useStore.setState({
      questDetails: new Map([["q-67", cached]]),
      questDetailEtags: new Map([["q-67", '"detail-v1"']]),
    });
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"detail-v1"' });
    const { container } = render(
      <>
        <button type="button" data-producer-nearby-control="dense-0">
          Prior tool summary
        </button>
        <button type="button" data-producer-nearby-control="dense-1">
          Prior thread endpoint
        </button>
        <MessageBubble
          message={assistantMessage("a5", "Created [q-67 feedback #4](quest:q-67:feedback:4) as a follow-up.")}
          sessionId="s1"
          questLinkSurface="chat-feed"
        />
        <button type="button" data-producer-nearby-control="dense-2">
          Next thread endpoint
        </button>
        <button type="button" data-producer-nearby-control="dense-3">
          Next routing reminder
        </button>
      </>,
    );
    const markdown = container.querySelector<HTMLElement>(".markdown-body")!;
    const anchor = within(markdown).getByRole("link", { name: "q-67 feedback #4" });
    const eye = within(markdown).getByRole("button", { name: /Preview q-67 feedback #4/ });
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(markdown);
    selection.removeAllRanges();
    selection.addRange(range);
    const selectedText = selection.toString();

    fireEvent.pointerEnter(anchor, { pointerType: "mouse", clientX: 620, clientY: 725 });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    const title = screen.getByTestId("quest-feed-title-preview");
    expect(title).not.toHaveAttribute("data-placement", "no-fit");
    expect(title).toHaveStyle({ visibility: "visible" });
    expect(within(title).getByTestId("quest-feed-title-preview-target")).toHaveTextContent("q-67 feedback #4");
    expect(within(title).getByTestId("quest-feed-title-preview-status")).toHaveTextContent("Refined");
    expect(title).toHaveTextContent("Dense transition hover title");
    expect(within(markdown).getByRole("link", { name: "q-67 feedback #4" })).toBe(anchor);
    expect(anchor).toHaveAttribute("href", "#/session/s1?quest=q-67&feedback=4");
    expect(anchor.nextElementSibling).toBe(eye);
    expect(selection.toString()).toBe(selectedText);
    selection.removeAllRanges();
    vi.runOnlyPendingTimers();
  });

  it("keeps producer-rendered eye hover usable around inert and hidden dense controls", async () => {
    const cached = quest("q-65", "Dense producer detail");
    useStore.setState({
      questDetails: new Map([["q-65", cached]]),
      questDetailEtags: new Map([["q-65", '"detail-v1"']]),
    });
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"detail-v1"' });
    render(
      <>
        <MessageBubble
          message={assistantMessage("a3", "Review [q-65](quest:q-65) beside dense controls.")}
          sessionId="s1"
          questLinkSurface="chat-feed"
        />
        <button type="button" inert tabIndex={-1} data-producer-nearby-control="cover">
          Inert dense overlay
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-producer-nearby-control="cover"
          style={{ display: "none", opacity: 0, pointerEvents: "none" }}
        >
          Hidden dense overlay
        </button>
      </>,
    );
    const eye = screen.getByRole("button", { name: /Preview q-65/ });
    expect(eye).toHaveTextContent("");
    expect(eye.querySelector("svg[aria-hidden='true']")).toBeInTheDocument();

    fireEvent.pointerEnter(eye, { pointerType: "mouse", clientX: 205, clientY: 110 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Dense producer detail" });
    expect(dialog).toHaveAttribute("data-open-mode", "hover");
    expect(dialog).toHaveAttribute("data-surface", "popover");
    expect(document.activeElement).not.toBe(dialog);
  });

  it("preserves a visible focusable producer control as a rich-placement exclusion", async () => {
    const cached = quest("q-66", "Protected producer control");
    useStore.setState({
      questDetails: new Map([["q-66", cached]]),
      questDetailEtags: new Map([["q-66", '"detail-v1"']]),
    });
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"detail-v1"' });
    render(
      <>
        <MessageBubble
          message={assistantMessage("a4", "Review [q-66](quest:q-66) beside a focusable control.")}
          sessionId="s1"
          questLinkSurface="chat-feed"
        />
        <button
          type="button"
          aria-disabled="true"
          data-producer-nearby-control="cover"
          style={{ pointerEvents: "none" }}
        >
          Keyboard-focusable pagination
        </button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview q-66/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Protected producer control" });
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
