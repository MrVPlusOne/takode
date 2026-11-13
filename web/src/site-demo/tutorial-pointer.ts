/**
 * The demo's tutorial hints: a soft ring, drawn for a few seconds around the part of the real app's
 * screen the chapter's caption names. The app knows nothing of it; the ring sits on top and lets
 * clicks through.
 */
import type { PointerTarget } from "./pocket-ledger.js";

const RING_MS = 3200;
/** Room kept between a hint and the edge of the area it scrolls in, so the ring clears headers and footers. */
const ROOM = 14;

interface Hint {
  /** What to ring: one element, or several ringed as one. */
  at: Element[];
  /** Bring its top or bottom to that edge of its scroll area; by default, scroll only as far as needed. */
  align?: "start" | "end";
  /** Draw the ring on the element's own outline rather than around it, so the box shows one outline. */
  onBorder?: boolean;
}

/** Finds the part of the screen each hint points at, by what the visitor reads there. */
const HINTS: Record<PointerTarget, () => Hint | null> = {
  composer: () =>
    hint(
      around(visible("textarea"), (el) => parseFloat(getComputedStyle(el).borderTopWidth) > 0),
      {
        onBorder: true,
      },
    ),
  tabs: () => {
    const strip = buttonWithText(/^(Home)$/)?.closest('[role="tablist"]');
    const tabs = [...(strip?.querySelectorAll('[role="tab"]') ?? [])].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    return tabs.length ? { at: tabs } : null;
  },
  worker: () => hint(around(buttonWithText(/^Open session$/), (el) => el.getBoundingClientRect().height > 70)),
  question: () =>
    hint(
      around(textElement(/Which fix should #19 make\?/), (el) => /which fix\?[\s\S]*Reply/i.test(el.textContent ?? "")),
    ),
  bell: () => hint(document.querySelector('button[aria-label^="Everything that needs attention"]')),
  status: () =>
    hint(
      around(last(textElements(/^(Waiting|Ready)$/)), (el) =>
        /^(Waiting|Ready)\s*\S/.test(el.textContent?.trim() ?? ""),
      ),
    ),
  // Wide screens show the decision beside the code, question and answers together. Narrow ones put the
  // code between them, so the question comes first and the answers get their own hint.
  "review-decision": () => {
    const panel = decisionPanel();
    if (panel) return { at: [panel] };
    const heading = textElement(/^Needs your decision$/);
    return hint(
      outermost(heading, (el) => !/Keep as is/.test(el.textContent ?? "")),
      { align: "start" },
    );
  },
  "review-answers": () => {
    if (decisionPanel()) return null;
    const answers = around(buttonWithText(/^Keep as is$/), (el) => el.querySelector("textarea") !== null);
    return hint(answers, { align: "end" });
  },
};

export function pointAt(target: PointerTarget): void {
  const first = HINTS[target]();
  if (!first) return;
  let found = first;
  let foundAt = performance.now();
  bringIntoView(found);
  installStyle();
  const ring = document.createElement("div");
  ring.className = "takode-demo-pointer";
  const pad = found.onBorder ? 0 : 5;
  if (found.onBorder) ring.style.borderRadius = getComputedStyle(found.at[0]).borderRadius;
  document.body.append(ring);
  const place = () => {
    // The app re-renders and adds to what the ring follows (a new tab, say), so look again now and then.
    if (performance.now() - foundAt > 250 || found.at.some((el) => !el.isConnected)) {
      found = HINTS[target]() ?? found;
      foundAt = performance.now();
    }
    const rects = found.at.map((el) => el.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    Object.assign(ring.style, {
      left: `${left - pad}px`,
      top: `${top - pad}px`,
      width: `${Math.max(...rects.map((r) => r.right)) - left + 2 * pad}px`,
      height: `${Math.max(...rects.map((r) => r.bottom)) - top + 2 * pad}px`,
    });
    if (ring.isConnected) requestAnimationFrame(place);
  };
  place();
  setTimeout(() => ring.remove(), RING_MS);
}

/** Scrolls the conversation to its newest message once the view has settled. */
export function settleFeed(): void {
  for (const delay of [700, 1600]) {
    setTimeout(() => {
      const feed = document.querySelector<HTMLElement>('[data-testid="message-feed-scroll-container"]');
      if (feed) feed.scrollTop = feed.scrollHeight;
    }, delay);
  }
}

function installStyle(): void {
  if (document.getElementById("takode-demo-pointer-style")) return;
  const style = document.createElement("style");
  style.id = "takode-demo-pointer-style";
  style.textContent = `
.takode-demo-pointer {
  position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; border-radius: 12px;
  border: 2px solid rgb(196 74 52 / 0.9); box-shadow: 0 0 0 5px rgb(196 74 52 / 0.16);
  animation: takode-demo-pointer ${RING_MS}ms ease forwards;
}
@keyframes takode-demo-pointer {
  0% { opacity: 0; transform: scale(1.04); }
  14% { opacity: 1; transform: scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .takode-demo-pointer { animation: none; } }`;
  document.head.append(style);
}

function hint(element: Element | null, options: Omit<Hint, "at"> = {}): Hint | null {
  return element ? { at: [element], ...options } : null;
}

/** The review's decision panel, when it sits beside the code and fits on screen. */
function decisionPanel(): Element | null {
  const panel = around(textElement(/^Needs your decision$/), (el) => /Keep as is/.test(el.textContent ?? ""));
  const height = panel?.getBoundingClientRect().height ?? 0;
  return height > 0 && height < innerHeight - 140 ? panel : null;
}

function bringIntoView({ at: [element], align }: Hint): void {
  const area = align && scrollArea(element);
  if (!area) {
    element.scrollIntoView({ block: "nearest" });
    return;
  }
  const box = element.getBoundingClientRect();
  const view = area.getBoundingClientRect();
  const by = align === "start" ? box.top - view.top - ROOM : box.bottom - view.bottom + ROOM;
  area.scrollBy({ top: by, behavior: "smooth" });
}

function scrollArea(element: Element): Element | null {
  return around(element.parentElement, (el) => {
    const overflow = getComputedStyle(el).overflowY;
    return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight;
  });
}

function visible(selector: string): Element | null {
  return [...document.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().width > 0) ?? null;
}

function buttonWithText(pattern: RegExp): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => pattern.test(button.textContent?.trim() ?? "") && button.getBoundingClientRect().width > 0,
    ) ?? null
  );
}

function textElements(pattern: RegExp): Element[] {
  return [...document.querySelectorAll("body *")].filter(
    (el) =>
      el.children.length <= 2 && pattern.test(el.textContent?.trim() ?? "") && el.getBoundingClientRect().width > 0,
  );
}

function textElement(pattern: RegExp): Element | null {
  return textElements(pattern).at(-1) ?? null;
}

function last(elements: Element[]): Element | null {
  return elements.at(-1) ?? null;
}

/** The farthest ancestor of `element` (or itself) reached while each step still `fits`. */
function outermost(element: Element | null, fits: (element: Element) => boolean): Element | null {
  let found: Element | null = null;
  for (let el = element; el && el !== document.body && fits(el); el = el.parentElement) found = el;
  return found;
}

/** The nearest ancestor of `element` (or itself) that `fits`. */
function around(element: Element | null, fits: (element: Element) => boolean): Element | null {
  for (let el = element; el && el !== document.body; el = el.parentElement) if (fits(el)) return el;
  return null;
}
