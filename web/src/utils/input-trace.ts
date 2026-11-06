import { useEffect, useSyncExternalStore } from "react";
import {
  INPUT_TRACE_MAX_EVENTS,
  INPUT_TRACE_BATCH_SIZE,
  INPUT_TRACE_WINDOW_MS,
  type InputTraceEvent,
  type InputTraceReport,
  type SavedInputTraceEvent,
} from "../../shared/input-trace.js";
import { InputTraceUpload } from "./input-trace-upload.js";
import { api } from "../api.js";
import { useStore } from "../store.js";

/**
 * The input trace (Settings > Diagnostics): while the user has it on, this page keeps the last
 * hour of input activity in memory and saves new events incrementally to the server. An optional
 * "Report input glitch" keeps a snapshot in the log. Turning it off stops recording. No text is kept: keys
 * that type characters are recorded as "char", and text only as lengths.
 */

interface Recorder {
  since: number;
  events: SavedInputTraceEvent[];
  sequence: number;
  upload: InputTraceUpload;
  /** Settles the outcome of events whose dispatch has finished; a report wants them all. */
  settle: () => void;
  stop: () => void;
}

let recorder: Recorder | null = null;
const listeners = new Set<() => void>();
let lastReport: { at: number; eventCount: number } | { at: number; error: string } | null = null;
let lastSave: { at: number; error?: string } | null = null;

/** Last automatic upload result, distinct from an explicitly saved glitch report. */
export function useInputTraceSaveStatus(): typeof lastSave {
  return useSyncExternalStore(subscribe, () => lastSave);
}

/** Keeps the trace recording while the user has it on in Settings; mount once, in the app root. */
export function useInputTraceRecorder(): void {
  const enabled = useStore((state) => state.diagnostics.inputTrace);
  useEffect(() => (enabled ? startInputTrace() : undefined), [enabled]);
}

/** Whether the trace is recording in this page, for components that offer reporting. */
export function useInputTraceRecording(): boolean {
  return useSyncExternalStore(subscribe, () => recorder !== null);
}

/** The outcome of the last report, so whatever started it can say it was sent. */
export function useLastInputGlitchReport(): typeof lastReport {
  return useSyncExternalStore(subscribe, () => lastReport);
}

/** Starts recording, replacing any earlier recording; returns the function that stops it. */
export function startInputTrace(win: Window = window): () => void {
  recorder?.stop();
  const doc = win.document;
  const pending: Array<[InputTraceEvent, Event]> = [];
  const reached = new WeakSet<Event>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pastePending = false;
  // Diagnostics also work on HTTP hosts, where randomUUID may be unavailable. This is a
  // recording identity, never an auth token (the same fallback as browser-load diagnostics).
  const traceId =
    globalThis.crypto?.randomUUID?.() ??
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
    );
  const since = Date.now();
  const upload = new InputTraceUpload(
    (after) => {
      return {
        traceId,
        recordingSince: since,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        events: current.events
          .filter((event) => event.seq > after && event.t >= Date.now() - INPUT_TRACE_WINDOW_MS)
          .slice(0, INPUT_TRACE_BATCH_SIZE),
      };
    },
    (result) => {
      if (recorder !== current) return;
      lastSave = result;
      notify();
    },
  );

  // The default action's fate is known only once every listener has run: settle it a tick later.
  const settle = () => {
    flushTimer = null;
    for (const [entry, event] of pending.splice(0)) {
      entry.outcome = event.defaultPrevented ? "prevented" : reached.has(event) ? "default" : "stopped";
    }
  };
  const onCapture = (event: Event) => {
    const entry = describeEvent(event, doc);
    if (!entry) return;
    record(entry);
    if (event.type === "paste") pastePending = true;
    if (!CANCELABLE_TYPES.has(event.type)) return;
    pending.push([entry, event]);
    flushTimer ??= setTimeout(() => {
      settle();
      if (pastePending) {
        pastePending = false;
        upload.flush();
      }
    }, 0);
  };
  const onBubble = (event: Event) => reached.add(event);
  const onWindowFocus = (event: Event) => {
    if (event.target === win) traceInputEvent({ type: event.type === "focus" ? "window-focus" : "window-blur" });
  };
  const onVisibility = () => {
    traceInputEvent({ type: doc.visibilityState === "hidden" ? "page-hidden" : "page-visible" });
    if (doc.visibilityState === "hidden") {
      current.settle();
      upload.flush(true);
    }
  };
  const onPageHide = () => {
    current.settle();
    upload.flush(true);
  };
  const onOnline = () => upload.flush();

  for (const type of TRACED_TYPES) win.addEventListener(type, onCapture, true);
  for (const type of CANCELABLE_TYPES) win.addEventListener(type, onBubble);
  win.addEventListener("focus", onWindowFocus, true);
  win.addEventListener("blur", onWindowFocus, true);
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("online", onOnline);

  const current: Recorder = {
    since,
    sequence: 0,
    upload,
    events: [],
    settle: () => {
      if (flushTimer) clearTimeout(flushTimer);
      settle();
      pastePending = false;
    },
    stop: () => {
      for (const type of TRACED_TYPES) win.removeEventListener(type, onCapture, true);
      for (const type of CANCELABLE_TYPES) win.removeEventListener(type, onBubble);
      win.removeEventListener("focus", onWindowFocus, true);
      win.removeEventListener("blur", onWindowFocus, true);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("online", onOnline);
      upload.stop();
      if (flushTimer) clearTimeout(flushTimer);
      if (recorder === current) {
        recorder = null;
        notify();
      }
    },
  };
  recorder = current;
  lastSave = null;
  notify();
  return current.stop;
}

/** Adds a Takode change (a draft replaced, the composer folding) to the trace; nothing while it is off. */
export function traceInputEvent(event: Omit<InputTraceEvent, "t">): void {
  if (recorder) record({ t: Date.now(), ...event });
}

/** The trace as it would be reported now, or null while it is off. */
export function inputTraceReport(): InputTraceReport | null {
  if (!recorder) return null;
  recorder.settle();
  const cutoff = Date.now() - INPUT_TRACE_WINDOW_MS;
  return {
    reportedAt: Date.now(),
    recordingSince: recorder.since,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    events: recorder.events.filter((event) => event.t >= cutoff).map(({ seq: _seq, ...event }) => event),
  };
}

/** Sends the trace to the server log. Returns false while the trace is off. */
export function reportInputGlitch(): boolean {
  const report = inputTraceReport();
  if (!report) return false;
  api
    .reportInputTrace(report)
    .then(({ eventCount }) => setLastReport({ at: report.reportedAt, eventCount }))
    .catch((error: unknown) => {
      console.error("[input-trace] Could not send the input trace:", error);
      setLastReport({ at: report.reportedAt, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
}

const TRACED_TYPES = [
  "keydown",
  "keyup",
  "pointerdown",
  "focusin",
  "focusout",
  "beforeinput",
  "textInput",
  "input",
  "paste",
  "compositionstart",
  "compositionend",
] as const;
const CANCELABLE_TYPES = new Set(["keydown", "pointerdown", "beforeinput", "textInput", "paste"]);
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

function record(event: InputTraceEvent): void {
  if (!recorder) return;
  const events = recorder.events;
  events.push(Object.assign(event, { seq: ++recorder.sequence }));
  recorder.upload.schedule();
  const cutoff = event.t - INPUT_TRACE_WINDOW_MS;
  let drop = Math.max(0, events.length - INPUT_TRACE_MAX_EVENTS);
  while (drop < events.length && events[drop].t < cutoff) drop += 1;
  if (drop > 0) events.splice(0, drop);
}

function describeEvent(event: Event, doc: Document): InputTraceEvent | null {
  const entry: InputTraceEvent = {
    t: Date.now(),
    type: event.type,
    trusted: event.isTrusted,
    target: describeElement(event.target),
    active: describeElement(doc.activeElement),
  };
  if (event instanceof KeyboardEvent) {
    // Keyup is kept only where it says something: releasing a modifier, or a Cmd/Ctrl shortcut.
    if (event.type === "keyup" && !MODIFIER_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey) return null;
    entry.key = describeKey(event);
    if (event.isComposing) entry.composing = true;
  }
  if ("inputType" in event && typeof event.inputType === "string") entry.inputType = event.inputType;
  const clipboard = (event as ClipboardEvent).clipboardData;
  if (event.type === "paste" && clipboard) {
    entry.clipboard = {
      types: Array.from(clipboard.types ?? []),
      textLength: clipboard.getData("text/plain").length,
      files: clipboard.files?.length ?? 0,
    };
  }
  const text = textState(event.target);
  if (text) Object.assign(entry, text);
  return entry;
}

/** A key by name, never the character it types: "Meta+v", "Enter", "char". */
function describeKey(event: KeyboardEvent): string {
  if (MODIFIER_KEYS.has(event.key)) return event.key;
  const printable = [...event.key].length === 1;
  if (printable && !event.metaKey && !event.ctrlKey) return event.altKey ? "Alt+char" : "char";
  const modifiers = [
    event.metaKey && "Meta",
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
  ].filter(Boolean);
  return [...modifiers, printable ? event.key.toLowerCase() : event.key].join("+");
}

/** A short element description, such as "textarea.composer" or "div#composer-input-card[role=button]". */
function describeElement(target: EventTarget | null): string | undefined {
  if (!target) return undefined;
  if (typeof Window !== "undefined" && target instanceof Window) return "window";
  if (target instanceof Document) return "document";
  if (!(target instanceof Element)) return undefined;
  let description = target.tagName.toLowerCase();
  const testId = target.getAttribute("data-testid");
  if (testId) description += `#${testId}`;
  const role = target.getAttribute("role");
  if (role) description += `[role=${role}]`;
  if (target.closest('[data-testid="composer-minimizer"]')) {
    description += target.closest('[data-testid="side-column"]') ? ".side-composer" : ".composer";
  }
  return description;
}

function textState(target: EventTarget | null): Pick<InputTraceEvent, "length" | "selection"> | null {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const selection: [number, number] | undefined =
      target.selectionStart === null || target.selectionEnd === null
        ? undefined
        : [target.selectionStart, target.selectionEnd];
    return { length: target.value.length, ...(selection ? { selection } : {}) };
  }
  if (target instanceof HTMLElement && target.isContentEditable) return { length: target.textContent?.length ?? 0 };
  return null;
}

function setLastReport(report: NonNullable<typeof lastReport>): void {
  lastReport = report;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}
