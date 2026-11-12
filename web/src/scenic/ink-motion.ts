/**
 * Ink motion for the scenic backgrounds: a new answer arrives on its sheet of paper like ink
 * soaking into xuan paper. The arrival plays once and removes itself, so an idle page draws
 * nothing; it doesn't play with reduced motion, and it never changes layout or delays the text.
 */
import { scenicMotionAllowed } from "./scenic-styles.js";

/** A conversation's feed. */
const FEED = "[data-feed-content-root]";
/** A message in the feed, named by its feed block id across re-renders. */
const BLOCK = "[data-feed-block-id]";
/** Quiet time after a feed first appears or reloads, while its history fills in. */
const SETTLE_MS = 1500;
/** More new sheets than this at once is a reload (a thread switch, a history window), not an arrival. */
const MAX_ARRIVALS = 3;

/**
 * Plays the ink arrival for new answers in the conversations under `root` while it runs. Returns a
 * stop function. Does nothing with reduced motion.
 */
export function startInkMotion(root: HTMLElement): () => void {
  if (!scenicMotionAllowed()) return () => {};
  return watchArrivals(root);
}

function watchArrivals(root: HTMLElement): () => void {
  const seen = new Set<string>();
  const settledAt = new WeakMap<Element, number>();
  for (const block of root.querySelectorAll(BLOCK)) seen.add(block.getAttribute("data-feed-block-id")!);
  for (const feed of root.querySelectorAll(FEED)) settledAt.set(feed, performance.now());

  const observer = new MutationObserver((records) => {
    // What arrived: each added element holding a message not seen before: a whole new sheet, or a
    // message joining an answer already showing.
    const fresh = new Map<Element, Element[]>();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        // A conversation that just appeared starts its quiet time: what it shows is history.
        const feeds = node.matches(FEED) ? [node] : node.querySelectorAll(FEED);
        for (const feed of feeds) settledAt.set(feed, performance.now());
        const blocks = node.matches(BLOCK) ? [node] : [...node.querySelectorAll(BLOCK)];
        let unseen = 0;
        for (const block of blocks) {
          const id = block.getAttribute("data-feed-block-id")!;
          if (seen.has(id)) continue;
          seen.add(id);
          unseen += 1;
        }
        const feed = node.closest(FEED);
        if (!unseen || !feed || node.closest('[data-testid="user-message-bubble"]')) continue;
        if (node.querySelector('[data-testid="user-message-bubble"]')) continue;
        if (!fresh.has(feed)) fresh.set(feed, []);
        fresh.get(feed)!.push(node);
      }
    }
    const now = performance.now();
    for (const [feed, arrivals] of fresh) {
      const since = settledAt.get(feed);
      if (since === undefined || now - since < SETTLE_MS || arrivals.length > MAX_ARRIVALS) {
        // A feed that just appeared or reloaded: what it shows is history, not arrivals.
        if (since === undefined || arrivals.length > MAX_ARRIVALS) settledAt.set(feed, now);
        continue;
      }
      // Only the newest turn receives messages; older turns fill in when you scroll back.
      const turns = feed.querySelectorAll(".turn-container");
      const last = turns[turns.length - 1];
      for (const element of arrivals) {
        if (element.closest(".turn-container") === last) arrive(element as HTMLElement);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Plays one arrival on `sheet` (a new sheet, or a message joining one): like ink soaking into xuan
 * paper, it spreads out from its centre as an irregular blot with fibrous edges, already about 40%
 * open so the text reads from the first frame, and grows until it covers the corners while the
 * text sharpens.
 */
export function arrive(sheet: HTMLElement): void {
  const width = sheet.offsetWidth;
  const height = sheet.offsetHeight;
  const start = Math.sqrt((0.38 * width * height) / Math.PI) / BLOT_CORE;
  const end = Math.hypot(width, height) / 2 / BLOT_CORE;
  const look = sheet.style;
  const before = [look.maskImage, look.maskRepeat, look.maskPosition, look.maskSize];
  Object.assign(look, { maskImage: inkBlot(), maskRepeat: "no-repeat", maskPosition: "50% 50%" });
  const animation = sheet.animate(
    [
      { maskSize: `${start}px ${start}px`, filter: "blur(0.6px)", opacity: 0.7 },
      { maskSize: `${end}px ${end}px`, filter: "blur(0px)", opacity: 1 },
    ],
    { duration: 350, easing: "cubic-bezier(0.3, 0.45, 0.4, 1)" },
  );
  animation.onfinish = animation.oncancel = () => {
    [look.maskImage, look.maskRepeat, look.maskPosition, look.maskSize] = before;
  };
}

/** The fraction of the blot's size that its solid core reaches from the centre, at the least. */
const BLOT_CORE = 0.19;
let blot: string | undefined;

/**
 * An ink blot as a mask image: an irregular, wobbling disc in a few layers that fade outward, the
 * outer ones with thin fibres reaching out, like ink spreading in xuan paper. Vector shapes, so it
 * stays crisp and cheap at any size; drawn once per page.
 */
export function inkBlot(): string {
  if (blot) return blot;
  let seed = 20261112;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const phases = [random(), random(), random()].map((value) => value * Math.PI * 2);
  const layers: string[] = [];
  for (const [scale, alpha, fibres] of [
    [1, 0.3, 22],
    [0.9, 0.45, 12],
    [0.82, 0.7, 0],
    [0.75, 1, 0],
  ] as const) {
    const points: string[] = [];
    for (let step = 0; step < 240; step++) {
      const angle = (step / 240) * Math.PI * 2;
      const wobble =
        7 * Math.sin(3 * angle + phases[0]!) +
        4 * Math.sin(5 * angle + phases[1]!) +
        2 * Math.sin(11 * angle + phases[2]!);
      let radius = scale * (64 + wobble) + (random() - 0.5) * 1.5;
      if (fibres && random() < 0.18) radius += fibres * (0.3 + random() * 0.7);
      points.push(`${(100 + radius * Math.cos(angle)).toFixed(1)},${(100 + radius * Math.sin(angle)).toFixed(1)}`);
    }
    layers.push(`<polygon points="${points.join(" ")}" fill-opacity="${alpha}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" preserveAspectRatio="none">${layers.join("")}</svg>`;
  blot = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return blot;
}
