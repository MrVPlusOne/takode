// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import {
  persistLeaderViewportPosition,
  readLeaderViewportPosition,
  requestThreadViewportSnapshot,
} from "../utils/thread-viewport.js";
import { MessageFeed } from "./MessageFeed.js";

const sendToSession = vi.hoisted(() => vi.fn((_sessionId: string, _message: BrowserOutgoingMessage) => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { searchSessionMessages: vi.fn().mockResolvedValue({ results: [], hasMore: false, nextOffset: null }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-restore-fallback";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
const history: BrowserIncomingMessage[] = Array.from(
  { length: 30 },
  (_, index) =>
    [
      {
        type: "user_message",
        id: `request-${index}`,
        content: `Request ${index}`,
        timestamp: index * 10,
        threadKey: "main",
        threadRefs: [{ threadKey: "main", source: "explicit" }],
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        timestamp: index * 10 + 1,
        threadKey: "main",
        threadRefs: [{ threadKey: "main", source: "explicit" }],
        message: {
          id: `answer-${index}`,
          type: "message",
          role: "assistant",
          model: "claude",
          content: [{ type: "text", text: `Answer ${index}` }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ] as BrowserIncomingMessage[],
).flat();

function deliverWindow(fromItem: number, targetMessageId?: string) {
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: "main",
    fromItem,
    itemCount: 6,
    sectionItemCount: 6,
    visibleItemCount: 1,
    targetMessageId,
  });
  act(() =>
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: sync.threadKey,
      entries: sync.entries,
      window: sync.window,
    }),
  );
}

function installGeometry() {
  const descriptors = new Map(
    ["clientHeight", "offsetHeight", "scrollHeight", "scrollTop"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, key),
    ]),
  );
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalScroll = Element.prototype.scrollTo;
  const positions = new WeakMap<HTMLElement, number>();
  const isFeed = (el: HTMLElement) => el.dataset.testid === "message-feed-scroll-container";
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-message-id]")];
  const bottom = () => rows().length * 400;
  for (const key of ["clientHeight", "offsetHeight", "scrollHeight"]) {
    Object.defineProperty(HTMLDivElement.prototype, key, {
      configurable: true,
      get() {
        return isFeed(this) ? (key === "scrollHeight" ? bottom() + 12 : 400) : 0;
      },
    });
  }
  Object.defineProperty(HTMLDivElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return positions.get(this) ?? 0;
    },
    set(value: number) {
      positions.set(this, Math.max(0, Math.min(value, bottom() + 12 - 400)));
    },
  });
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (this instanceof HTMLDivElement && typeof options === "object") this.scrollTop = options.top ?? 0;
  };
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (isFeed(this)) return DOMRect.fromRect({ width: 600, height: 400 });
    const contained = rows().flatMap((row, index) => (row === this || this.contains(row) ? [index] : []));
    if (contained.length) {
      const feed = document.querySelector<HTMLElement>('[data-testid="message-feed-scroll-container"]');
      const top = contained[0]! * 400 + 100;
      return DOMRect.fromRect({
        y: top - (feed?.scrollTop ?? 0),
        width: 600,
        height: (contained.at(-1)! + 1) * 400 - top,
      });
    }
    return originalRect.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Element.prototype.scrollTo = originalScroll;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(HTMLDivElement.prototype, key, descriptor);
      else delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[key];
    }
  };
}

let restoreGeometry: () => void;
beforeEach(() => {
  useStore.getState().reset();
  localStorage.clear();
  sendToSession.mockClear();
  window.location.hash = "";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  useStore.getState().addSession({
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude",
    model: "claude",
    tools: [],
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
  } as unknown as SessionState);
  deliverWindow(8);
  restoreGeometry = installGeometry();
});
afterEach(() => {
  cleanup();
  restoreGeometry();
  vi.unstubAllGlobals();
});

function save(anchorMessageId?: string, anchorTurnId?: string) {
  persistLeaderViewportPosition(SESSION_ID, "main", {
    scrollTop: 900,
    scrollHeight: 4812,
    isAtBottom: false,
    anchorMessageId,
    anchorTurnId,
    anchorOffsetTop: 60,
  });
}

function expectLatest() {
  const feed = screen.getByTestId("message-feed-scroll-container");
  const last = feed.querySelector<HTMLElement>('[data-message-id="answer-29"]');
  expect(last).not.toBeNull();
  expect(last!.getBoundingClientRect().bottom).toBeCloseTo(feed.getBoundingClientRect().bottom, 3);
}

describe("saved viewport restoration failure", () => {
  it("requests the missing exact message even when its older host turn is mounted", () => {
    // A host turn can begin far above the saved message. It is not an exact
    // restore and must not short-circuit the server's stable-target lookup.
    save("missing-answer", "request-10");
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "thread_window_request",
        target_message_id: "missing-answer",
      }),
    );
    expect(screen.getByTestId("message-feed-scroll-container").scrollTop).toBe(0);
    deliverWindow(-1, "missing-answer");
    expectLatest();
  });

  it("uses latest after the targeted delivery cannot restore the anchor, including repeated returns", async () => {
    // The producer returns latest when the source has no such target. Reusing
    // numeric coordinates inside that replacement drops the reader mid-window.
    save("missing-answer", "missing-turn");
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    deliverWindow(-1, "missing-answer");
    expectLatest();
    await act(async () => {
      await requestThreadViewportSnapshot(SESSION_ID);
    });
    expect(readLeaderViewportPosition(SESSION_ID, "main")?.isAtBottom).toBe(true);
    for (let cycle = 0; cycle < 2; cycle++) {
      view.rerender(<div>Away</div>);
      view.rerender(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
      deliverWindow(-1);
      expectLatest();
    }
  });

  it("keeps a valid old message and offset across delayed window delivery", () => {
    // Message age and the current slice are not evidence that an anchor failed.
    save("answer-2", "request-2");
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(screen.getByTestId("message-feed-scroll-container").scrollTop).toBe(0);
    deliverWindow(-1, "answer-2");
    const anchor = document.querySelector<HTMLElement>('[data-message-id="answer-2"]')!;
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(60, 3);
  });

  it("does not resurrect saved restoration after deliberate bottom navigation", () => {
    save("answer-2", "request-2");
    let jumpToLatest: (() => void) | null = null;
    render(
      <MessageFeed
        sessionId={SESSION_ID}
        threadKey="main"
        onJumpToLatestReady={(jump) => {
          jumpToLatest = jump;
        }}
      />,
    );
    act(() => jumpToLatest!());
    deliverWindow(-1);
    expectLatest();
    expect(
      sendToSession.mock.calls.filter(
        ([, message]) => message.type === "thread_window_request" && message.target_message_id === "answer-2",
      ),
    ).toHaveLength(1);
  });

  it("waits through unrelated window updates before resolving a saved target", () => {
    // Refresh revisions can advance for live traffic unrelated to the lookup.
    // Neither that revision nor a new window object proves the target is absent.
    save("answer-2", "request-2");
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    act(() => useStore.setState({ threadWindowRefreshRevisions: new Map([[SESSION_ID, 1]]) }));
    deliverWindow(14);
    expect(screen.getByTestId("message-feed-scroll-container").scrollTop).toBe(0);
    deliverWindow(-1, "answer-2");
    expect(
      document.querySelector<HTMLElement>('[data-message-id="answer-2"]')!.getBoundingClientRect().top,
    ).toBeCloseTo(60, 3);
  });

  it("does not treat a cached target lookup as a reply to a new restore attempt", () => {
    // A previous visit may have queried the same target. Its cached response
    // cannot prove a fresh failure before this visit's lookup has completed.
    deliverWindow(-1, "missing-answer");
    save("missing-answer", "missing-turn");
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "thread_window_request",
        target_message_id: "missing-answer",
      }),
    );
    expect(screen.getByTestId("message-feed-scroll-container").scrollTop).toBe(0);
    deliverWindow(-1, "missing-answer");
    expectLatest();
  });

  it.each([
    "thread",
    "history",
  ] as const)("preserves lookup identity when retrying a missing %s cache entry", (kind) => {
    // A hash-only delivery may outlive the browser's cached contents. Its
    // uncached retry must retain the target so restoration can settle afterward.
    const target = "answer-2";
    if (kind === "thread") {
      const sync = buildThreadWindowSync({
        messageHistory: history,
        threadKey: "main",
        fromItem: -1,
        itemCount: 6,
        sectionItemCount: 6,
        visibleItemCount: 1,
        targetMessageId: target,
      });
      handleMessage(SESSION_ID, {
        type: "thread_window_sync",
        thread_key: "main",
        entries: [],
        cache_hit: true,
        window: { ...sync.window, window_hash: "evicted-target-window" },
      });
    } else {
      handleMessage(SESSION_ID, {
        type: "history_window_sync",
        messages: [],
        cache_hit: true,
        window: {
          from_turn: 0,
          turn_count: 6,
          total_turns: 30,
          has_older_items: false,
          has_newer_items: true,
          start_index: 0,
          section_turn_count: 6,
          visible_section_count: 1,
          target_message_id: target,
          window_hash: "evicted-target-window",
        },
      });
    }
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: kind === "thread" ? "thread_window_request" : "history_window_request",
        target_message_id: target,
      }),
    );
  });

  it("uses latest for unanchored coordinates inside an unrelated bounded slice", () => {
    // Equal scroll heights do not establish equal contents or a stable identity.
    save();
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: -1,
      }),
    );
    deliverWindow(-1);
    expectLatest();
  });

  it.each(["missing", "bottom"])("does not retain a cached older slice with %s saved state", (state) => {
    // A warm cache can still contain older history at entry. Neither absent
    // restore state nor saved latest intent grants that cached slice ownership.
    if (state === "bottom")
      persistLeaderViewportPosition(SESSION_ID, "main", {
        scrollTop: 0,
        scrollHeight: 0,
        isAtBottom: true,
      });
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "thread_window_request",
        from_item: -1,
      }),
    );
    deliverWindow(-1);
    expectLatest();
  });

  it("gives a fresh explicit message destination priority over saved restoration", () => {
    // A deep link/search selection owns entry even when the saved viewport is
    // invalid. The fallback must never compete with that valid new destination.
    save("missing-answer", "request-10");
    useStore.getState().requestScrollToMessage(SESSION_ID, "answer-2");
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);
    expect(sendToSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: "thread_window_request",
        target_message_id: "answer-2",
      }),
    );
    expect(
      sendToSession.mock.calls.some(
        ([, message]) => message.type === "thread_window_request" && message.target_message_id === "missing-answer",
      ),
    ).toBe(false);
    deliverWindow(-1, "answer-2");
    expect(document.querySelector('[data-message-id="answer-2"]')).not.toBeNull();
    expect(document.querySelector('[data-message-id="answer-29"]')).toBeNull();
  });
});
