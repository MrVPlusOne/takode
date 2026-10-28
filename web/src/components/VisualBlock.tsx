/**
 * A visual block in rendered Markdown (a ```visual fence): the agent's HTML, CSS and
 * SVG with Takode's kit, shown in a sandboxed frame that can't reach Takode.
 *
 * - Two layers, so scrolling never shows a blank or a redraw: a still picture (the visual
 *   without scripts, kept once it has drawn) loads well ahead of the viewport and stays, and the
 *   live frame loads near the viewport behind it, takes over once it has drawn, and unloads
 *   when far away. Heights are kept so the feed doesn't jump.
 * - Every visual runs live the first time. Where frames share Takode's own process
 *   (Safari, so every iPhone), a visual that runs code is first drawn by the server, and
 *   one the server refuses (it hangs, crashes or is far too big) doesn't run by itself.
 * - The frame supervisor stops a visual that hangs, crashes, keeps the processor busy or
 *   slows Takode down. From then on this device shows it as a still picture (drawn by the
 *   server) with a Run button.
 */
import { FullScreenButton, FullScreenPanel } from "./FullScreenPanel.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildVisualDocument,
  parseVisualBlock,
  visualFallbackText,
  visualIsInteractive,
  visualSourceHash,
  visualUsesScripts,
  VISUAL_MAX_ELEMENTS,
  VISUAL_MAX_SOURCE_BYTES,
  type VisualTheme,
} from "../../shared/visual-block.js";
import { useStore } from "../store.js";
import { detectVisualIsolation, visualModeOverride, type VisualIsolation } from "../utils/visual-isolation.js";
import {
  forgetVisualFailure,
  markVisualRunning,
  rememberVisualStopped,
  visualStopReason,
} from "../utils/visual-stop-memory.js";
import { visualFrameSupervisor, type FrameHandle } from "../utils/visual-frame-supervisor.js";
import { keepVisualStill, stripVisualScripts, visualStill } from "../utils/visual-still-cache.js";
import { CodeBlock } from "./MarkdownCodeBlock.js";
import { CardMoreMenu, useCardExport } from "./CardMoreMenu.js";
import { exportVisualImage } from "../utils/artifact-export.js";

const MAX_INLINE_HEIGHT = 2400;
/** How far ahead of the viewport a live frame loads, where frames run outside Takode's process. */
const LIVE_MARGIN_PX = 1200;
const STILL_MARGIN_PX = 5000;
const DEFAULT_HEIGHT = 180;

/**
 * How a visual is shown:
 * - `live`: as written, scripts and helpers running;
 * - `checked`: live, once the server has drawn it without trouble (shared-process browsers);
 * - `still`: a script-free picture: the visual itself when it runs no code, else the server's drawing.
 */
export type VisualPlan = "live" | "checked" | "still";

/** Decide how to show a visual on this device. */
export function planVisual(options: {
  isolation: VisualIsolation;
  usesScripts: boolean;
  /** Running it does more than its still picture shows (scripts, charts, handlers). */
  interactive?: boolean;
  /** Stopped earlier on this device and not run again since. */
  stopped: boolean;
  /** The user tapped Run. */
  forced: boolean;
  override?: "live" | "static" | null;
}): VisualPlan {
  if (options.override) return options.override === "live" ? "live" : "still";
  if (options.forced) return "live";
  if (options.stopped) return "still";
  if (!options.usesScripts) return "still";
  if (options.isolation === "isolated") return "live";
  // Where frames share Takode's process, a diagram is shown as the server drew it: running the
  // helper there would cost the page a heavy script for the same picture.
  return options.interactive === false ? "still" : "checked";
}

/** Something to show instead of the visual, with its plain-text version. */
interface Problem {
  reason: string;
  /** Offer Run to force the visual anyway. */
  canRun: boolean;
}

/** Heights by source, theme and width, so a visual remounts at its size. */
const knownHeights = new Map<string, number>();

let frameCounter = 0;

export function VisualBlock({ source }: { source: string }) {
  const dark = useStore((s) => s.darkMode);
  const theme: VisualTheme = dark ? "dark" : "light";
  const block = useMemo(() => parseVisualBlock(source), [source]);
  const hash = useMemo(() => visualSourceHash(source), [source]);
  const fallback = useMemo(() => visualFallbackText(block), [block]);
  const usesScripts = useMemo(() => visualUsesScripts(block.html), [block]);
  const interactive = useMemo(() => visualIsInteractive(block.html), [block]);
  const tooLarge = useMemo(() => new TextEncoder().encode(source).length > VISUAL_MAX_SOURCE_BYTES, [source]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Live frames load near the viewport; still pictures, cheap and script-free, well ahead of it.
  const isolation = useIsolation();
  // Where frames share Takode's process (iPhone), agent scripts start only once the visual is on
  // screen, as before; the still picture already covers it while it loads.
  const near = useNearViewport(rootRef, isolation === "isolated" ? LIVE_MARGIN_PX : 0);
  const keep = useNearViewport(rootRef, STILL_MARGIN_PX);
  const width = useWidth(rootRef);
  const [forced, setForced] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stopReason, setStopReason] = useState<string | null>(() => visualStopReason(hash));
  const [problemState, setProblem] = useState<Problem | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const heightKey = `${hash}:${theme}:${Math.round(width / 40)}`;
  const [height, setHeight] = useState(() => knownHeights.get(heightKey) ?? DEFAULT_HEIGHT);

  // A visual that runs no code and was stopped here would only stop again: show its text.
  const stoppedWithoutCode = stopReason !== null && !usesScripts && !forced;
  const plan =
    isolation === null
      ? null
      : planVisual({
          isolation,
          usesScripts,
          interactive,
          stopped: stopReason !== null,
          forced,
          override: visualModeOverride(),
        });
  const problem =
    problemState ??
    (stoppedWithoutCode ? { reason: `Stopped on this device because ${stopReason}.`, canRun: true } : null);
  const doc = useFrameDocument({
    // A still picture, and the server's check draw, are prepared well ahead of the viewport; a
    // live frame waits until the visual is near. The server draws for the column's width.
    enabled:
      (plan === "live" ? near : keep) &&
      plan !== null &&
      (width > 0 || !usesScripts || plan === "live") &&
      !problem &&
      !tooLarge,
    source,
    hash,
    html: block.html,
    usesScripts,
    theme,
    plan: plan ?? "still",
    width,
    attempt,
    onProblem: setProblem,
  });
  // Running in the page's own process: guard against a freeze that reloads the app.
  const guardHash = doc?.live && isolation === "shared" ? hash : null;
  // The still layer: the visual itself when it runs no code, else the still kept once it drew.
  const [still, setStill] = useState(() => visualStill(hash, theme));
  // The server's check draw may have kept a still while the document was prepared.
  useEffect(() => setStill(visualStill(hash, theme)), [hash, theme, doc]);
  const staticDoc = doc && !doc.live ? doc : null;
  const cachedStill = staticDoc ? null : (still ?? visualStill(hash, theme));
  const cachedStillDoc = useMemo(
    () =>
      cachedStill
        ? {
            frameId: "still",
            html: buildVisualDocument({
              html: cachedStill,
              theme,
              mode: "static",
              assetBase: window.location.origin,
              frameId: "still",
            }),
          }
        : null,
    [cachedStill, theme],
  );
  const stillDoc = staticDoc ?? cachedStillDoc;
  // Once a still can stand in, the live frame unloads when far away; until then it stays.
  // (In Takode's own process, scripts run only while near, still or not.)
  const liveDoc = doc?.live && (near || (!cachedStill && isolation === "isolated")) ? doc : null;
  const onSnapshot = useCallback(
    (html: string) => {
      // The first still is enough: later ones differ only in generated ids, and replacing it
      // would reload the still layer for nothing.
      if (visualStill(hash, theme)) return;
      const kept = keepVisualStill(hash, theme, html);
      if (kept) setStill(kept);
    },
    [hash, theme],
  );

  const onSize = useCallback(
    (value: number) => {
      knownHeights.set(heightKey, value);
      setHeight(value);
    },
    [heightKey],
  );
  const onStopped = useCallback(
    (reason: string) => {
      rememberVisualStopped(hash, reason);
      setForced(false);
      setStopReason(reason);
      // A still picture has nothing simpler to fall back to; neither has a visual that runs no code.
      if (plan === "still") setProblem({ reason: `Stopped on this device because ${reason}.`, canRun: true });
    },
    [hash, plan],
  );
  const run = () => {
    forgetVisualFailure(hash);
    setStopReason(null);
    setProblem(null);
    setForced(true);
    setAttempt((value) => value + 1);
  };
  // Run is offered where running shows something the still picture can't.
  const runnable = plan === "still" && interactive && !problem;
  const { start: startExport, task: exportTask } = useCardExport(
    useCallback(() => exportVisualImage(source, block.title ?? "Visual"), [source, block.title]),
  );
  const menuItems = [
    { label: showSource ? "Hide source" : "Show source", onClick: () => setShowSource((value) => !value) },
    ...(!tooLarge ? [{ label: "Export as image (.png)", onClick: () => startExport("png") }] : []),
  ];

  return (
    <div ref={rootRef} className="my-2 min-w-0" data-visual-block="" data-visual-plan={plan ?? undefined}>
      <div className="mb-1 flex min-h-6 select-none items-center gap-2 text-[12px] text-cc-muted" data-copy-exclude="">
        {block.title ? <span className="min-w-0 truncate font-medium">{block.title}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {runnable ? <VisualButton onClick={run} label="Run" title="Run this visual's scripts" /> : null}
          {!problem && !tooLarge ? <FullScreenButton onClick={() => setEnlarged(true)} /> : null}
          <CardMoreMenu items={menuItems} task={exportTask} />
        </span>
      </div>
      {stopReason && !problem && !forced ? (
        <div className="mb-1 text-[12px] text-cc-muted" data-copy-exclude="" data-testid="visual-block-stopped">
          Stopped on this device because {stopReason}. {usesScripts ? "This is a still picture." : null}
        </div>
      ) : null}
      {tooLarge || problem ? (
        <VisualProblem
          reason={tooLarge ? "This visual is too large to show." : problem!.reason}
          fallback={fallback}
          onRun={!tooLarge && problem?.canRun ? run : undefined}
        />
      ) : (
        <div
          className="tk-visual-body relative overflow-hidden rounded-lg"
          style={{ height: Math.min(height, MAX_INLINE_HEIGHT) }}
          data-testid="visual-block-body"
        >
          <div className="tk-visual-placeholder absolute inset-0 rounded-lg bg-cc-hover/40" aria-hidden="true" />
          {stillDoc && (keep || near) ? (
            <VisualFrame
              key={`still:${stillDoc.html.length}:${stillDoc.frameId}`}
              doc={stillDoc.html}
              frameId={stillDoc.frameId}
              title={block.title ?? "Visual"}
              guardHash={null}
              layer="still"
              onSize={onSize}
            />
          ) : null}
          {liveDoc ? (
            <VisualFrame
              key={`${attempt}:${plan}:${liveDoc.frameId}`}
              doc={liveDoc.html}
              frameId={liveDoc.frameId}
              title={block.title ?? "Visual"}
              guardHash={guardHash}
              layer="live"
              onSize={onSize}
              onStopped={onStopped}
              onSnapshot={onSnapshot}
            />
          ) : null}
          {height > MAX_INLINE_HEIGHT ? (
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cc-bg to-transparent pb-2 pt-8 text-[13px] text-cc-primary"
            >
              Show all
            </button>
          ) : null}
        </div>
      )}
      {!problem && !tooLarge && fallback ? (
        // The frame holds no copyable text: copies, selections and screen readers get the plain-text version.
        <p className="sr-only" data-visual-fallback="">
          {fallback}
        </p>
      ) : null}
      {showSource ? (
        <CodeBlock lang="visual" wrapLongContent={false}>
          {source}
        </CodeBlock>
      ) : null}
      {enlarged && doc && !problem ? (
        <VisualEnlarged
          html={doc.html}
          title={block.title ?? "Visual"}
          guardHash={guardHash}
          onClose={() => setEnlarged(false)}
        />
      ) : null}
    </div>
  );
}

function VisualButton({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded px-1.5 py-0.5 text-[12px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:px-2.5 pointer-coarse:py-1.5"
    >
      {label}
    </button>
  );
}

function VisualProblem({ reason, fallback, onRun }: { reason: string; fallback: string; onRun?: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-cc-border px-3 py-2.5" data-testid="visual-block-problem">
      <div className="text-[13px] font-medium text-cc-fg">{reason}</div>
      {fallback ? <div className="mt-1 text-[13px] text-cc-muted">{fallback}</div> : null}
      {onRun ? (
        <button
          type="button"
          onClick={onRun}
          className="mt-2 rounded-md border border-cc-border px-2.5 py-1 text-[12px] text-cc-fg hover:bg-cc-hover pointer-coarse:py-1.5"
        >
          Run anyway
        </button>
      ) : null}
    </div>
  );
}

/**
 * The document the frame shows, following the plan. `live` is the visual as written;
 * `checked` asks the server to draw it first and runs it only if that went well; `still`
 * is the visual without scripts, or the server's drawing of one that needs them.
 */
function useFrameDocument({
  enabled,
  source,
  html,
  usesScripts,
  theme,
  plan,
  width,
  attempt,
  onProblem,
  hash,
}: {
  enabled: boolean;
  source: string;
  hash: string;
  html: string;
  usesScripts: boolean;
  theme: VisualTheme;
  plan: VisualPlan;
  width: number;
  attempt: number;
  onProblem: (problem: Problem) => void;
}): { html: string; frameId: string; live: boolean } | null {
  const [doc, setDoc] = useState<{
    html: string;
    frameId: string;
    live: boolean;
    key: string;
    drawKey: string;
  } | null>(null);
  const widthBucket = Math.max(200, Math.round(width / 20) * 20);
  // The document to show changes with these; a still picture drawn by the server is also redrawn
  // for a new width, but the old one stays on screen until the new one arrives.
  const key = `${plan}:${theme}:${attempt}:${source}`;
  const drawKey = `${key}:${plan === "still" && usesScripts ? widthBucket : 0}`;

  useEffect(() => {
    if (!enabled || doc?.drawKey === drawKey) return;
    const frameId = `v${++frameCounter}`;
    const assetBase = window.location.origin;
    const show = (body: string, live: boolean) =>
      setDoc({
        key,
        drawKey,
        frameId,
        live,
        html: buildVisualDocument({ html: body, theme, mode: live ? "live" : "static", assetBase, frameId }),
      });
    if (plan === "live") return show(html, true);
    if (!usesScripts) {
      const cleaned = stripVisualScripts(html);
      if (cleaned.elementCount > VISUAL_MAX_ELEMENTS) {
        return onProblem({ reason: tooManyElements(cleaned.elementCount), canRun: false });
      }
      return show(cleaned.html, false);
    }
    let cancelled = false;
    fetchSnapshot(source, theme, widthBucket)
      .then((result) => {
        if (cancelled) return;
        const refused = refusal(result);
        if (refused) return onProblem({ reason: refused, canRun: true });
        // The check draw doubles as the still shown while the live visual loads.
        if (result.status === "ok" && result.snapshotHtml !== undefined) {
          keepVisualStill(hash, theme, result.snapshotHtml);
        }
        if (result.status !== "ok" || result.snapshotHtml === undefined) {
          // The server can't draw visuals right now: a checked visual runs anyway, guarded;
          // a still one has no picture to show.
          if (plan === "checked") return show(html, true);
          return onProblem({ reason: "Takode can't draw a still picture of this visual right now.", canRun: true });
        }
        if (plan === "checked") return show(html, true);
        show(result.snapshotHtml, false);
      })
      .catch(() => {
        if (cancelled) return;
        if (plan === "checked") return show(html, true);
        onProblem({ reason: "Takode couldn't draw a still picture of this visual.", canRun: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, drawKey, doc?.drawKey, html, usesScripts, plan, onProblem, source, theme, widthBucket, hash]);

  return doc && doc.key === key ? doc : null;
}

interface SnapshotResponse {
  status: "ok" | "timeout" | "crashed" | "unavailable";
  snapshotHtml?: string;
  elementCount: number;
  tooLarge?: boolean;
  detail?: string;
}

/** Why the server's drawing rules this visual out of running by itself, if it does. */
function refusal(result: SnapshotResponse): string | null {
  if (result.status === "timeout")
    return "This visual never finished drawing when Takode checked it, so it doesn't run by itself.";
  if (result.status === "crashed")
    return `This visual crashed when Takode checked it${result.detail ? ` (${result.detail.replace(/\.$/, "")})` : ""}, so it doesn't run by itself.`;
  if (result.status === "ok" && result.tooLarge) {
    return result.elementCount > VISUAL_MAX_ELEMENTS
      ? tooManyElements(result.elementCount)
      : "This visual is too large to show here.";
  }
  return null;
}

function tooManyElements(count: number): string {
  return `This visual has ${count.toLocaleString()} elements, too many to show here.`;
}

async function fetchSnapshot(source: string, theme: VisualTheme, width: number): Promise<SnapshotResponse> {
  const response = await fetch("/api/visuals/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, theme, width }),
  });
  if (!response.ok) throw new Error(`Snapshot failed (${response.status})`);
  return (await response.json()) as SnapshotResponse;
}

/**
 * One sandboxed frame and its watchdog. The frame has an opaque origin (no
 * allow-same-origin): it can't reach Takode's page, storage or API, and talks only
 * through the messages of Takode's frame script.
 */
function VisualFrame({
  doc,
  frameId,
  title,
  guardHash,
  layer = "live",
  onSize,
  onStopped,
  onSnapshot,
  fill = false,
}: {
  doc: string;
  frameId: string;
  title: string;
  /** Set when the visual runs in the page's own process: guards against reload loops. */
  guardHash: string | null;
  /**
   * `live` runs the agent's scripts under the supervisor. `still` is a script-free picture: it
   * can't hang (no agent code, animations off, element count capped), so it loads at once,
   * beside any other, without the supervisor.
   */
  layer?: "live" | "still";
  onSize?: (height: number) => void;
  onStopped?: (reason: string) => void;
  /** The live frame's still copy, once it drew. */
  onSnapshot?: (html: string) => void;
  fill?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const handleRef = useRef<FrameHandle | null>(null);

  // The supervisor decides when the iframe exists: it loads frames one at a time and
  // unloads all of them to end a process a stuck visual has frozen. The iframe is added and
  // removed directly, not through React state, because a visual running in the page's own
  // process can starve React's rendering; removing the element stops it at once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Marked only while the iframe exists: a queued visual can't be what froze the page.
    let clearRunning: (() => void) | null = null;
    const unmount = () => {
      frameRef.current?.remove();
      frameRef.current = null;
    };
    const mount = () => {
      if (guardHash) clearRunning = markVisualRunning(guardHash);
      const frame = document.createElement("iframe");
      frame.title = title;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("data-testid", "visual-block-frame");
      // The layers' CSS: a live frame stays invisible until it has drawn, then hides the still.
      frame.setAttribute(`data-${layer}`, "");
      frame.className = `block w-full border-0 ${fill ? "h-full" : "absolute inset-0 h-full"}`;
      // Match the document's own scheme: a frame whose scheme differs from its element's paints
      // an opaque backdrop instead of staying transparent over the feed.
      frame.style.colorScheme = doc.startsWith('<!doctype html><html class="dark"') ? "dark" : "light";
      frame.srcdoc = doc;
      frameRef.current = frame;
      host.appendChild(frame);
    };
    if (layer === "still") {
      mount();
      return unmount;
    }
    const handle = visualFrameSupervisor().register({
      setMounted: (value) => {
        if (!value) {
          clearRunning?.();
          unmount();
          return;
        }
        mount();
      },
      stop: (reason) => {
        clearRunning?.();
        onStopped?.(reason);
      },
      sameProcess: !!guardHash,
    });
    handleRef.current = handle;
    return () => {
      handle.unregister();
      handleRef.current = null;
      clearRunning?.();
      unmount();
    };
  }, [doc, title, fill, guardHash, onStopped, layer]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { takodeVisual?: string; kind?: string; height?: number; lag?: number; href?: string };
      if (!data || data.takodeVisual !== frameId || typeof data.kind !== "string") return;
      handleRef.current?.message(data.kind, data.lag);
      if (data.kind === "ready") frame.setAttribute("data-ready", "");
      if (data.kind === "snapshot" && typeof (data as { html?: unknown }).html === "string") {
        onSnapshot?.((data as { html: string }).html);
      }
      if ((data.kind === "ready" || data.kind === "size") && typeof data.height === "number" && data.height > 0) {
        onSize?.(data.height);
      } else if (data.kind === "link" && typeof data.href === "string" && /^https?:/i.test(data.href)) {
        window.open(data.href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId, onSize, onSnapshot]);

  return <div ref={hostRef} className={fill ? "h-full" : "absolute inset-0"} />;
}

function VisualEnlarged({
  html,
  title,
  guardHash,
  onClose,
}: {
  html: string;
  title: string;
  guardHash: string | null;
  onClose: () => void;
}) {
  // The enlarged copy is its own frame, so it reports its own messages.
  const frameId = useMemo(() => `v${++frameCounter}`, []);
  const doc = useMemo(() => html.replace(/("id":")v\d+(")/, `$1${frameId}$2`), [html, frameId]);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  return (
    <FullScreenPanel title={title} onClose={onClose}>
      <div className="relative mx-auto max-w-[1600px]" style={{ height }}>
        <VisualFrame doc={doc} frameId={frameId} title={title} guardHash={guardHash} onSize={setHeight} fill />
      </div>
    </FullScreenPanel>
  );
}

function useIsolation(): VisualIsolation | null {
  const [isolation, setIsolation] = useState<VisualIsolation | null>(null);
  useEffect(() => {
    let cancelled = false;
    void detectVisualIsolation().then((value) => {
      if (!cancelled) setIsolation(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return isolation;
}

/** Within `marginPx` of the viewport, so a visual is ready before it scrolls in. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, marginPx: number): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // The margin must apply to the scrolling feed itself: measured against the window, a visual
    // below the feed's visible part is clipped away and never counts as near until it shows.
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      root: scrollParent(element),
      rootMargin: `${marginPx}px 0px`,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, marginPx]);
  return near;
}

/** The nearest ancestor that scrolls vertically, or null for the window. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
