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

function installGeometry() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function getClientRects(this: Element) {
    const element = this as HTMLElement;
    if (element.matches("a.cc-quest-link")) {
      return [DOMRect.fromRect({ x: 100, y: 100, width: 90, height: 20 })] as unknown as DOMRectList;
    }
    if (element.dataset.testid === "quest-feed-preview-button") {
      return [DOMRect.fromRect({ x: 192, y: 97, width: 26, height: 26 })] as unknown as DOMRectList;
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
