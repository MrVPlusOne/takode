// @vitest-environment jsdom
/**
 * Ink motion for the scenic backgrounds: which messages count as arrivals (only new messages in the
 * newest turn, never history that fills in or a conversation that just opened). jsdom has no Web
 * Animations, so `animate` is recorded instead of played.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startInkMotion } from "./ink-motion.js";

let animated: Element[] = [];
let now = 0;
let stop: () => void = () => {};

beforeEach(() => {
  animated = [];
  now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Element.prototype.animate = vi.fn(function (this: Element) {
    animated.push(this);
    return {
      onfinish: null,
      oncancel: null,
      cancel() {},
      finish() {},
    } as unknown as Animation;
  }) as unknown as Element["animate"];
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
  })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = "";
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

/** A conversation pane with one feed of two turns, each holding one answer. */
function pane(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-feed-content-root="true">
      <div class="turn-container"><div><div data-feed-block-id="a1">old answer</div></div></div>
      <div class="turn-container"><div id="answers"><div data-feed-block-id="b1">answer</div></div></div>
    </div>`;
  document.body.append(root);
  return root;
}

function block(id: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-feed-block-id", id);
  element.textContent = id;
  return element;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("message arrivals", () => {
  it("plays for a new message in the newest turn, once its conversation has settled", async () => {
    const root = pane();
    stop = startInkMotion(root);
    now += 2000;
    const fresh = block("b2");
    root.querySelector("#answers")!.append(fresh);
    await flush();
    expect(animated).toEqual([fresh]);
  });

  it("leaves history alone: older turns, a just-opened conversation and a burst of messages", async () => {
    const root = pane();
    stop = startInkMotion(root);
    now += 2000;
    // Scrolling back fills in older turns.
    root.querySelector(".turn-container")!.firstElementChild!.append(block("a2"));
    await flush();
    // A thread switch brings several messages at once.
    const answers = root.querySelector("#answers")!;
    for (const id of ["c1", "c2", "c3", "c4"]) answers.append(block(id));
    await flush();
    // Another conversation opens; its messages are history too, even after a moment.
    const other = document.createElement("div");
    other.setAttribute("data-feed-content-root", "true");
    other.innerHTML = '<div class="turn-container"><div data-feed-block-id="d1">x</div></div>';
    root.append(other);
    await flush();
    now += 500;
    other.querySelector(".turn-container")!.append(block("d2"));
    await flush();
    expect(animated).toEqual([]);
  });

  it("does not play a message again when it is drawn anew", async () => {
    const root = pane();
    stop = startInkMotion(root);
    now += 2000;
    const answers = root.querySelector("#answers")!;
    answers.replaceChildren(block("b1"));
    await flush();
    expect(animated).toEqual([]);
  });
});

describe("reduced motion", () => {
  it("plays nothing", async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia;
    const root = pane();
    stop = startInkMotion(root);
    now += 2000;
    root.querySelector("#answers")!.append(block("b2"));
    await flush();
    expect(animated).toEqual([]);
  });
});
