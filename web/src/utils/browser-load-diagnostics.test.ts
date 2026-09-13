// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserLoadDiagnostics } from "./browser-load-diagnostics.js";
import { BROWSER_LOAD_WINDOW_MS, type BrowserLoadReportMessage } from "../../shared/browser-load-diagnostics.js";

let observer: BrowserLoadDiagnostics;
let sent: BrowserLoadReportMessage[];
let frames: FrameRequestCallback[];
let hidden = false;
const send = (message: BrowserLoadReportMessage) => {
  sent.push(message);
  return true;
};
const stages = () => sent.flatMap((message) => message.report.stages);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    {
      type: "navigate",
      name: "https://private.example/secret",
      requestStart: 1,
      responseStart: 2,
      responseEnd: 3,
      domInteractive: 4,
      domContentLoadedEventEnd: 5,
      loadEventEnd: 6,
    } as unknown as PerformanceEntry,
  ]);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  sent = [];
  observer = new BrowserLoadDiagnostics();
});
afterEach(() => {
  observer.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function flushFrames() {
  while (frames.length) frames.shift()!(performance.now());
}
function visibility(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("bounded frontend load diagnostics", () => {
  it("joins pre-socket startup and actual feed commits to server-issued identity without retaining URLs", () => {
    // Delayed connection/paint exercises the gap left by the server-only marker.
    observer.markAppCommitted();
    vi.advanceTimersByTime(15_000);
    observer.connect("s1", send);
    observer.capture("s1")("open");
    expect(sent).toEqual([]);
    observer.identify("s1", "physical-socket");
    observer.feedCommitted("s1", "q-12", true);
    vi.advanceTimersByTime(5_000);
    observer.feedCommitted("s1", "q-12", false, "abcdef");
    flushFrames();
    vi.advanceTimersByTime(200);
    expect(sent.every((message) => message.connection_id === "physical-socket")).toBe(true);
    expect(stages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "module_started", atMs: 0 }),
        expect.objectContaining({ stage: "connect", atMs: 15_000 }),
        expect.objectContaining({
          stage: "feed_commit",
          atMs: 20_000,
          view: "q-12",
          windowHash: "abcdef",
          loading: false,
        }),
        expect.objectContaining({ stage: "feed_frame", loading: false }),
      ]),
    );
    expect(sent[0]!.report.navigation).not.toHaveProperty("name");
    expect(JSON.stringify(sent)).not.toContain("private.example");
    expect(sent[0]!.report).toMatchObject({
      lifecycle: "startup",
      displayMode: "browser",
      frontendBuildId: "development",
    });
  });

  it("starts a fresh foreground window after long idle and cannot borrow old frame callbacks", () => {
    observer.connect("s1", send);
    observer.identify("s1", "first");
    observer.feedCommitted("s1", "main", false);
    const oldReport = observer.capture("s1");
    visibility(true);
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    visibility(false);
    oldReport("message_applied", { applyMs: 99 });
    observer.feedCommitted("s1", "main", false);
    flushFrames();
    vi.advanceTimersByTime(200);
    const foreground = sent.filter((message) => message.report.lifecycle === "foreground");
    expect(foreground.length).toBeGreaterThan(0);
    expect(foreground[0]!.report.hiddenMs).toBe(12 * 60 * 60 * 1000);
    expect(
      foreground.flatMap((message) => message.report.stages).filter((entry) => entry.stage === "feed_frame"),
    ).toHaveLength(1);
    expect(stages().some((entry) => entry.applyMs === 99)).toBe(false);
  });

  it("does not move replaced sockets' buffered stages or frames to the new socket", () => {
    observer.connect("s1", send);
    const stale = observer.capture("s1");
    observer.feedCommitted("s1", "main", true);
    observer.connect("s1", send);
    stale("message_applied", { applyMs: 123 });
    observer.identify("s1", "replacement");
    flushFrames();
    vi.advanceTimersByTime(200);
    expect(stages().some((entry) => entry.stage === "feed_frame" || entry.applyMs === 123)).toBe(false);
    expect(sent.every((message) => message.connection_id === "replacement")).toBe(true);
  });

  it("bounds pre-identity queues, batch sizes, and observation lifetime", () => {
    observer.connect("s1", send);
    for (let i = 0; i < 500; i++) observer.capture("s1")("view_request");
    observer.identify("s1", "bounded");
    observer.feedCommitted("s1", "main", false);
    // Exhausted capture must stop scheduling callbacks as well as stop logging.
    expect(frames).toHaveLength(0);
    expect(stages()).toHaveLength(64);
    expect(sent.every((message) => message.report.stages.length <= 16)).toBe(true);
    observer.connect("s2", send);
    observer.identify("s2", "expires");
    const before = stages().length;
    vi.advanceTimersByTime(BROWSER_LOAD_WINDOW_MS + 1);
    observer.capture("s2")("view_request");
    observer.feedCommitted("s2", "main", false);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(stages()).toHaveLength(before);
  });

  it("records persisted-page returns and standalone mode without forcing any reload", () => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    observer.connect("s1", send);
    observer.identify("s1", "standalone");
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(6000);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    flushFrames();
    vi.advanceTimersByTime(200);
    expect(sent.at(-1)!.report).toMatchObject({ lifecycle: "foreground", displayMode: "standalone", hiddenMs: 6000 });
    expect(stages()).toContainEqual(expect.objectContaining({ stage: "page_show", persisted: true }));
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("deduplicates committed state and isolates failed diagnostic sends", () => {
    observer.connect("s1", () => {
      throw new Error("disconnected");
    });
    expect(() => observer.identify("s1", "failed")).not.toThrow();
    observer.connect("s1", send);
    observer.identify("s1", "new");
    for (let i = 0; i < 10; i++) observer.feedCommitted("s1", "main", false, "abc");
    flushFrames();
    vi.advanceTimersByTime(200);
    expect(stages().filter((entry) => entry.stage === "feed_commit")).toHaveLength(1);
    observer.close("s1");
    const before = sent.length;
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(before);
  });
});
