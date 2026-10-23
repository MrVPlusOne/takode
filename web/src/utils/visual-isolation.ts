/**
 * Decides how visual frames may run in this browser.
 *
 * Chrome and Edge on desktop run a sandboxed, opaque-origin frame in its own process,
 * so a visual that loops or eats memory can't freeze Takode, and the page can remove
 * it. Safari (every iPhone browser) and some Android setups run the frame in the
 * page's own process, where one endless loop freezes the whole app. There a visual
 * with scripts runs only after the server drew it without trouble.
 *
 * The answer is measured, not guessed from the user agent: a probe frame keeps its thread
 * busy for a moment while the page checks whether its own timers stalled. In a shared
 * process they always stall for the whole busy time. A busy page can make an isolated frame
 * look shared, never the other way round, so a "shared" answer is checked again before it
 * counts. (Timing the frame's own messages doesn't work: Chrome delivers a frame's
 * messages to the page only after the frame's busy task ends.)
 */
export type VisualIsolation = "isolated" | "shared";

const PROBE_BUSY_MS = 250;
/** A stall this long while the frame is busy means the frame runs on the page's thread. */
const SHARED_STALL_MS = 200;
const PROBE_ATTEMPTS = 3;
const STORAGE_KEY = "takode:visual-isolation";
/** Developer override for screenshots and tests: "static" or "live". */
export const VISUAL_MODE_OVERRIDE_KEY = "takode:visual-mode";

let pending: Promise<VisualIsolation> | null = null;

export function visualModeOverride(): "static" | "live" | null {
  try {
    const value = localStorage.getItem(VISUAL_MODE_OVERRIDE_KEY);
    return value === "static" || value === "live" ? value : null;
  } catch {
    return null;
  }
}

/** Whether visual frames run outside this page's process. Probed once per tab. */
export function detectVisualIsolation(): Promise<VisualIsolation> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved === "isolated" || saved === "shared") return saved;
    } catch {
      // Storage may be unavailable; probe anyway.
    }
    let result: VisualIsolation = "shared";
    for (let attempt = 0; attempt < PROBE_ATTEMPTS && result === "shared"; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await probe();
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, result);
    } catch {
      // Not persisted; the next tab probes again.
    }
    return result;
  })();
  return pending;
}

function probe(): Promise<VisualIsolation> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none";
    frame.srcdoc = `<script>var t=Date.now();while(Date.now()-t<${PROBE_BUSY_MS}){}parent.postMessage("takode-visual-probe-end","*")</script>`;
    // Every gap between the page's own ticks counts, from inserting the frame until just
    // after it reports: in a shared process the frame's busy loop shows up as one long gap.
    let worstGap = 0;
    let last = performance.now();
    const tick = window.setInterval(() => {
      const now = performance.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
    }, 10);
    const finish = (result: VisualIsolation) => {
      window.clearInterval(tick);
      window.removeEventListener("message", onMessage);
      window.clearTimeout(fallback);
      frame.remove();
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data !== "takode-visual-probe-end") return;
      window.setTimeout(() => finish(worstGap >= SHARED_STALL_MS ? "shared" : "isolated"), 40);
    };
    // If the frame never reports (old browser, blocked frames), treat it as sharing the page.
    const fallback = window.setTimeout(() => finish("shared"), 3000);
    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}
