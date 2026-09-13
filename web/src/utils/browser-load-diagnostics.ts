import {
  BROWSER_LOAD_BATCH_SIZE,
  BROWSER_LOAD_MAX_STAGES,
  BROWSER_LOAD_WINDOW_MS,
  type BrowserLoadReport,
  type BrowserLoadReportMessage,
  type BrowserLoadStage,
} from "../../shared/browser-load-diagnostics.js";

type Lifecycle = Pick<BrowserLoadReport, "lifecycleId" | "lifecycle" | "startedAtMs" | "hiddenMs"> & {
  stages: BrowserLoadStage[];
};
type StageDetails = Omit<BrowserLoadStage, "stage" | "atMs">;
type Reporter = (stage: BrowserLoadStage["stage"], details?: StageDetails, atMs?: number) => void;
interface Observation {
  life: Lifecycle;
  connectionId?: string;
  send: (message: BrowserLoadReportMessage) => boolean;
  pending: BrowserLoadStage[];
  count: number;
  timer?: ReturnType<typeof setTimeout>;
  feedSignature?: string;
}

/** A bounded diagnostic observer. It never drives connection, application or recovery state. */
export class BrowserLoadDiagnostics {
  private readonly documentId =
    globalThis.crypto?.randomUUID?.() ??
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
    );
  private readonly moduleStartedAtMs = performance.now();
  private nextLifecycleId = 0;
  private life: Lifecycle = {
    lifecycleId: 0,
    lifecycle: "startup",
    startedAtMs: this.moduleStartedAtMs,
    stages: [{ stage: "module_started", atMs: this.moduleStartedAtMs }],
  };
  private readonly observations = new Map<string, Observation>();
  private hiddenAt: number | undefined;
  private appCommitted = false;

  constructor() {
    if (typeof document === "undefined") return;
    if (document.hidden) this.hiddenAt = Date.now();
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("pagehide", this.onPageHide);
  }

  /** Start a socket-owned window. Replacement drops old queues and late callbacks. */
  connect(sessionId: string, send: Observation["send"]): void {
    this.close(sessionId);
    // This is diagnostic retention only; no application socket is closed by this cap.
    if (this.observations.size >= 16) this.close(this.observations.keys().next().value!);
    const now = performance.now();
    const life: Lifecycle =
      now - this.life.startedAtMs <= BROWSER_LOAD_WINDOW_MS
        ? this.life
        : {
            lifecycleId: ++this.nextLifecycleId,
            lifecycle: "connection",
            startedAtMs: now,
            stages: [],
          };
    this.observations.set(sessionId, { life, send, pending: [...life.stages], count: life.stages.length });
    this.capture(sessionId)("connect");
  }

  /** Bind only server-issued identity received on the current physical socket. */
  identify(sessionId: string, connectionId: string): void {
    const observation = this.observations.get(sessionId);
    if (!observation || observation.connectionId || !connectionId) return;
    observation.connectionId = connectionId;
    this.flush(observation);
  }

  /** Capture ownership now so an old receive/frame cannot be attributed to a later lifecycle. */
  capture(sessionId: string): Reporter {
    const observation = this.observations.get(sessionId);
    const life = observation?.life;
    return (stage, details = {}, atMs = performance.now()) => {
      if (!observation || observation.life !== life || this.observations.get(sessionId) !== observation) return;
      this.record(observation, { stage, atMs, ...details });
    };
  }

  /** Record a committed feed's actual view/hash, separately from receipt and frame scheduling. */
  feedCommitted(sessionId: string, view: string, loading: boolean, windowHash?: string): void {
    const observation = this.observations.get(sessionId);
    if (!observation || document.hidden) return;
    const signature = `${view}:${loading}:${windowHash ?? ""}`;
    if (observation.feedSignature === signature) return;
    observation.feedSignature = signature;
    const report = this.capture(sessionId);
    const details = { view: normalizeView(view), loading, ...safeWindowHash(windowHash) };
    report("feed_commit", details);
    afterFrames(() => {
      if (observation.feedSignature === signature) report("feed_frame", details);
    });
  }

  /** First root React commit; this does not assert that pixels have been presented. */
  markAppCommitted(): void {
    if (this.appCommitted) return;
    this.appCommitted = true;
    this.commonStage("app_commit");
    const life = this.life;
    afterFrames(() => {
      if (this.life === life) this.commonStage("app_frame");
    });
  }

  /** Drop only observer state and timers for a retired socket. */
  close(sessionId: string): void {
    const observation = this.observations.get(sessionId);
    if (observation?.timer) clearTimeout(observation.timer);
    this.observations.delete(sessionId);
  }

  /** Release listeners and diagnostic state when an isolated observer is disposed. */
  dispose(): void {
    for (const sessionId of this.observations.keys()) this.close(sessionId);
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pageshow", this.onPageShow);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.onPageHide();
    else this.foreground();
  };
  private onPageHide = (): void => {
    this.hiddenAt ??= Date.now();
    for (const observation of this.observations.values()) this.flush(observation);
  };
  private onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted && this.hiddenAt !== undefined) this.foreground();
    this.commonStage("page_show", { persisted: event.persisted });
  };

  private foreground(): void {
    if (this.hiddenAt === undefined) return;
    const now = performance.now();
    for (const observation of this.observations.values()) this.flush(observation);
    this.life = {
      lifecycleId: ++this.nextLifecycleId,
      lifecycle: "foreground",
      startedAtMs: now,
      hiddenMs: Math.max(0, Date.now() - this.hiddenAt),
      stages: [],
    };
    this.hiddenAt = undefined;
    for (const observation of this.observations.values()) {
      observation.life = this.life;
      observation.pending = [];
      observation.count = 0;
      observation.feedSignature = undefined;
    }
    this.commonStage("foreground");
    const life = this.life;
    afterFrames(() => {
      if (this.life === life) this.commonStage("foreground_frame");
    });
  }

  private commonStage(stage: BrowserLoadStage["stage"], details: StageDetails = {}): void {
    const entry = { stage, atMs: performance.now(), ...details };
    if (this.life.stages.length < 8) this.life.stages.push(entry);
    for (const observation of this.observations.values()) this.record(observation, entry);
  }

  private record(observation: Observation, entry: BrowserLoadStage): void {
    if (
      entry.atMs - observation.life.startedAtMs > BROWSER_LOAD_WINDOW_MS ||
      observation.count >= BROWSER_LOAD_MAX_STAGES
    )
      return;
    observation.count++;
    observation.pending.push(entry);
    if (observation.pending.length >= BROWSER_LOAD_BATCH_SIZE) this.flush(observation);
    else if (!observation.timer) observation.timer = setTimeout(() => this.flush(observation), 200);
  }

  private flush(observation: Observation): void {
    if (observation.timer) clearTimeout(observation.timer);
    observation.timer = undefined;
    if (!observation.connectionId || observation.pending.length === 0) return;
    const { stages: _commonStages, ...life } = observation.life;
    while (observation.pending.length > 0) {
      const stages = observation.pending.splice(0, BROWSER_LOAD_BATCH_SIZE);
      try {
        observation.send({
          type: "browser_load_report",
          connection_id: observation.connectionId,
          report: {
            documentId: this.documentId,
            ...life,
            moduleStartedAtMs: this.moduleStartedAtMs,
            timeOrigin: performance.timeOrigin,
            displayMode: isStandalone() ? "standalone" : "browser",
            visibility: document.hidden ? "hidden" : "visible",
            frontendBuildId: typeof __TAKODE_BUILD_ID__ === "string" ? __TAKODE_BUILD_ID__ : null,
            navigation: navigationTiming(),
            stages,
          },
        });
      } catch {
        // Best-effort telemetry must never retry, interrupt work, or enter the feed.
      }
    }
  }
}

/** Restrict view metadata to existing routing identifiers, never arbitrary URLs or titles. */
export function normalizeView(view: string | undefined): string | undefined {
  return view && /^(main|all|history|q-\d{1,12})$/.test(view) ? view : undefined;
}

/** Keep only the server's opaque window digest, not conversation content. */
export function safeWindowHash(hash: string | undefined): { windowHash?: string } {
  return hash && /^[a-f0-9]{1,128}$/i.test(hash) ? { windowHash: hash } : {};
}

function afterFrames(callback: () => void): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => requestAnimationFrame(callback));
}
function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function navigationTiming(): BrowserLoadReport["navigation"] {
  const entry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!entry) return undefined;
  return {
    type: entry.type,
    requestStart: entry.requestStart,
    responseStart: entry.responseStart,
    responseEnd: entry.responseEnd,
    domInteractive: entry.domInteractive,
    domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
    loadEventEnd: entry.loadEventEnd,
  };
}

export const browserLoadDiagnostics = new BrowserLoadDiagnostics();
