// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TurnCollapseState } from "../hooks/use-collapse-policy.js";
import { useStore } from "../store.js";
import { useJumpTargetPin } from "./message-feed-jump-target-pin.js";
import { findReadingPlace, KeepReadingPlace } from "./message-feed-reading-place.js";

// jsdom has no layout or ResizeObserver. The fixture lays out a 400px feed (its top at 100px) holding
// one turn: a question card (300px, 26px more while it shows "Include my comment") and below it the
// message being read (400px). The card's checkbox appears with pending comments and goes with the send,
// in the same React commit as the send request, which is what moved Safari readers.
const SESSION = "reading-place-session";
const FEED_TOP = 100;
const CHECKBOX_HEIGHT = 26;
let scrollTop = 0;
let turnTop = 0;

const observers = new Set<() => void>();
class TestResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    observers.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}

function layout(element: HTMLElement): DOMRect {
  if (element.id === "feed") return new DOMRect(0, FEED_TOP, 400, 400);
  const cardHeight = 300 + (document.getElementById("include") ? CHECKBOX_HEIGHT : 0);
  const top = FEED_TOP + turnTop - scrollTop;
  if (element.dataset.turnId) return new DOMRect(0, top, 400, cardHeight + 400);
  if (element.dataset.messageId === "card") return new DOMRect(0, top, 400, cardHeight);
  if (element.dataset.messageId === "reading") return new DOMRect(0, top + cardHeight, 400, 400);
  return new DOMRect(0, 0, 0, 0);
}

const turnStates: TurnCollapseState[] = [
  {
    turnId: "turn-1",
    overrideKey: "turn-1",
    defaultExpanded: true,
    isActivityExpanded: true,
    readyCollapsed: false,
    readyAnchorMessageId: null,
    finalFold: null,
  },
];

function Feed({ following }: { following: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(following);
  followingRef.current = following;
  const turnStatesRef = useRef(turnStates);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const { pinJumpTarget } = useJumpTargetPin({
    containerRef,
    contentRootRef,
    lastScrollTopRef,
    programmaticScrollTargetRef,
    scopeKey: SESSION,
  });
  const hasComments = useStore((s) => (s.composerDrafts.get(SESSION)?.annotations?.length ?? 0) > 0);
  return (
    <div id="feed" ref={containerRef}>
      <div ref={contentRootRef}>
        <KeepReadingPlace
          sessionId={SESSION}
          containerRef={containerRef}
          followingRef={followingRef}
          turnStatesRef={turnStatesRef}
          hold={pinJumpTarget}
        />
        <div data-turn-id="turn-1">
          <div data-message-id="card">
            Question card
            {hasComments && <label id="include">Include my comment</label>}
          </div>
          <div data-message-id="reading">The message being read</div>
        </div>
      </div>
    </div>
  );
}

function mountFeed(following = false) {
  const view = render(<Feed following={following} />);
  const container = view.container.querySelector<HTMLDivElement>("#feed")!;
  Object.defineProperties(container, {
    clientHeight: { value: 400 },
    offsetHeight: { value: 400 },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => (scrollTop = value),
    },
  });
  return container;
}

function readingOffset() {
  return document.querySelector<HTMLElement>('[data-message-id="reading"]')!.getBoundingClientRect().top - FEED_TOP;
}

const comment = {
  id: "c1",
  selectedText: "a passage",
  comment: "a comment",
  sourceMessageId: "reading",
};

function setComments(annotations: (typeof comment)[]) {
  const composerDrafts = new Map(useStore.getState().composerDrafts);
  composerDrafts.set(SESSION, { text: "", images: [], annotations });
  return { composerDrafts };
}

/** What a comment-only send does to the store in one go: the draft empties and the send is requested. */
function sendComments() {
  const composerDrafts = new Map(useStore.getState().composerDrafts);
  composerDrafts.delete(SESSION);
  act(() =>
    useStore.setState({
      composerDrafts,
      bottomAlignNextUserMessage: new Set([SESSION]),
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return layout(this);
  });
  scrollTop = 250;
  turnTop = 0;
  useStore.setState({
    composerDrafts: new Map(),
    bottomAlignNextUserMessage: new Set(),
    turnActivityOverrides: new Map(),
  });
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("finds the message under the middle of the feed", () => {
  const container = mountFeed();
  // The card spans 100..400 on screen and the read message 400..800; the middle is at 300.
  scrollTop = 0;
  expect(findReadingPlace(container)?.element.dataset.messageId).toBe("card");
  // Scrolled on, the card is off screen and the read message starts 100px above the feed's top.
  scrollTop = 400;
  expect(findReadingPlace(container)).toMatchObject({ offsetTop: -100 });
  expect(findReadingPlace(container)?.element.dataset.messageId).toBe("reading");
});

it("keeps the message being read in place when sending takes the checkbox off the question card", () => {
  // The reported jump: a comment-only send removed "Include my comment" from the open question card
  // above the reader, and Safari, which has no scroll anchoring, moved everything below it up.
  act(() => useStore.setState(setComments([comment])));
  const container = mountFeed();
  scrollTop = 400;
  const before = readingOffset();
  expect(findReadingPlace(container)?.element.dataset.messageId).toBe("reading");

  sendComments();

  expect(document.getElementById("include")).toBeNull();
  expect(readingOffset()).toBe(before);
  expect(scrollTop).toBe(400 - CHECKBOX_HEIGHT);
});

it("keeps the reader in place when a saved comment adds the checkbox", () => {
  mountFeed();
  scrollTop = 400;
  const before = readingOffset();

  act(() => useStore.setState(setComments([comment])));

  expect(document.getElementById("include")).not.toBeNull();
  expect(readingOffset()).toBe(before);
});

it("holds the commented message even when the card's message is the one mid-feed", () => {
  // The card's message (50..350 on screen) covers the middle of the feed and the commented message
  // starts below it, so holding whatever is mid-feed would let the growing card push the passage down.
  const container = mountFeed();
  scrollTop = 50;
  expect(findReadingPlace(container)?.element.dataset.messageId).toBe("card");
  const before = readingOffset();

  act(() => useStore.setState(setComments([comment])));

  expect(readingOffset()).toBe(before);
  expect(scrollTop).toBe(50 + CHECKBOX_HEIGHT);
});

it("keeps holding the place while the send lands", () => {
  const container = mountFeed();
  scrollTop = 400;
  const before = readingOffset();
  act(() => useStore.setState({ bottomAlignNextUserMessage: new Set([SESSION]) }));

  // The landing refreshes the thread window, which here adds 180px of older content above.
  turnTop += 180;
  for (const callback of [...observers]) callback();

  expect(readingOffset()).toBe(before);
  expect(container.scrollTop).toBe(580);
});

it("keeps the latest turn open when the reader is looking at it", () => {
  // The send starts a new turn, which used to fold this one into its summary under the reader.
  mountFeed();
  act(() => useStore.setState({ bottomAlignNextUserMessage: new Set([SESSION]) }));
  expect(useStore.getState().turnActivityOverrides.get(SESSION)?.get("turn-1")).toBe(true);
});

it("leaves the latest turn to fold when it is not on screen", () => {
  mountFeed();
  turnTop = 2000;
  act(() => useStore.setState({ bottomAlignNextUserMessage: new Set([SESSION]) }));
  expect(useStore.getState().turnActivityOverrides.get(SESSION)?.get("turn-1")).toBeUndefined();
});

it("lets a reader who follows the bottom keep following", () => {
  act(() => useStore.setState(setComments([comment])));
  mountFeed(true);
  scrollTop = 400;
  const before = readingOffset();

  sendComments();

  // Nothing holds the place: the feed's bottom-follow moves a following reader to the sent message.
  expect(readingOffset()).toBe(before - CHECKBOX_HEIGHT);
  expect(useStore.getState().turnActivityOverrides.get(SESSION)).toBeUndefined();
});
