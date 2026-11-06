// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const reportInputTrace = vi.hoisted(() =>
  vi.fn(async (report: { events: unknown[] }) => ({ ok: true, eventCount: report.events.length })),
);
vi.mock("../api.js", () => ({ api: { reportInputTrace } }));

import { INPUT_TRACE_MAX_EVENTS, INPUT_TRACE_WINDOW_MS } from "../../shared/input-trace.js";
import { inputTraceReport, reportInputGlitch, startInputTrace, traceInputEvent } from "./input-trace.js";

/**
 * The input trace records input activity only while it is on, never holds typed or pasted
 * text, says whether each event's default action survived the page's handlers, and keeps at
 * most the last hour (and a fixed number of events).
 */

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
  reportInputTrace.mockClear();
  vi.unstubAllGlobals();
});

/** Waits for the trace to settle each event's outcome, which it does a tick after dispatch. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function events() {
  return inputTraceReport()?.events ?? [];
}

function composerTextarea(value = "draft"): HTMLTextAreaElement {
  document.body.innerHTML = `<div data-testid="composer-minimizer"><textarea></textarea></div>`;
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  textarea.value = value;
  return textarea;
}

describe("input trace", () => {
  it("automatically saves a settled paste without a manual report, with lengths but no text", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("crypto", {}); // HTTP hosts still record when the secure-only UUID API is absent.
    stop = startInputTrace();
    const textarea = composerTextarea("draft");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { types: ["text/plain"], getData: () => "private link", files: [] },
    });
    textarea.dispatchEvent(paste);
    await settled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(fetch.mock.calls[0][1].body);
    expect(saved.traceId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(saved.events[0]).toMatchObject({ seq: 1, type: "paste", outcome: "default", clipboard: { textLength: 12 } });
    expect(JSON.stringify(saved)).not.toContain("private link");
    expect(reportInputTrace).not.toHaveBeenCalled();
  });
  it("records nothing and reports nothing while it is off", () => {
    traceInputEvent({ type: "draft-sync", before: 1, after: 2 });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(inputTraceReport()).toBeNull();
    expect(reportInputGlitch()).toBe(false);
    expect(reportInputTrace).not.toHaveBeenCalled();
  });

  it("names shortcut keys but never the characters typed", () => {
    stop = startInputTrace();
    const textarea = composerTextarea();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "S", shiftKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }));
    // A plain character's keyup says nothing new and is left out; a shortcut's is kept.
    textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "s", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "v", metaKey: true, bubbles: true }));

    expect(events().map((event) => `${event.type} ${event.key}`)).toEqual([
      "keydown char",
      "keydown char",
      "keydown Meta",
      "keydown Meta+v",
      "keyup Meta+v",
    ]);
    expect(events()[3]).toMatchObject({ target: "textarea.composer", length: 5, selection: [5, 5] });
    expect(JSON.stringify(events())).not.toMatch(/"s"|"S"/);
  });

  it("records what a paste offered without its text", () => {
    stop = startInputTrace();
    const textarea = composerTextarea("");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { types: ["text/plain", "text/html"], getData: () => "secret words", files: [] },
    });
    textarea.dispatchEvent(paste);

    expect(events()[0]).toMatchObject({
      type: "paste",
      clipboard: { types: ["text/plain", "text/html"], textLength: "secret words".length, files: 0 },
    });
    expect(JSON.stringify(events())).not.toContain("secret");
  });

  it("says whether a handler prevented or stopped the default action", async () => {
    stop = startInputTrace();
    const textarea = composerTextarea();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    const prevent = (event: Event) => event.preventDefault();
    textarea.addEventListener("keydown", prevent);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    textarea.removeEventListener("keydown", prevent);

    const stopIt = (event: Event) => event.stopPropagation();
    textarea.addEventListener("keydown", stopIt);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settled();

    expect(events().map((event) => `${event.key} ${event.outcome}`)).toEqual([
      "Enter default",
      "Tab prevented",
      "Escape stopped",
    ]);
  });

  it("keeps only the last hour and at most the event cap", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    stop = startInputTrace();
    traceInputEvent({ type: "draft-sync", before: 0, after: 3 });
    vi.setSystemTime(INPUT_TRACE_WINDOW_MS + 1);
    traceInputEvent({ type: "composer-expanded" });
    expect(events().map((event) => event.type)).toEqual(["composer-expanded"]);

    for (let i = 0; i < INPUT_TRACE_MAX_EVENTS + 5; i += 1) traceInputEvent({ type: "composer-collapsed" });
    expect(events()).toHaveLength(INPUT_TRACE_MAX_EVENTS);
  });

  it("forgets the record when turned off", () => {
    stop = startInputTrace();
    traceInputEvent({ type: "composer-expanded" });
    stop();
    stop = startInputTrace();
    expect(events()).toEqual([]);
  });

  it("sends the trace to the server when a glitch is reported", async () => {
    stop = startInputTrace();
    traceInputEvent({ type: "composer-expanded", detail: "s1:main" });
    expect(reportInputGlitch()).toBe(true);
    await settled();
    expect(reportInputTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ type: "composer-expanded", detail: "s1:main" })],
        userAgent: navigator.userAgent,
      }),
    );
  });
});
