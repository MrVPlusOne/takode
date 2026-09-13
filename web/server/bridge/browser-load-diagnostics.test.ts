import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserLoadReport } from "../../shared/browser-load-diagnostics.js";
import type { ServerLogEntry } from "../../shared/logging.js";
import { subscribeToServerLogs } from "../server-logger.js";
import {
  closeBrowserConnectionDiagnostics,
  openBrowserConnectionDiagnostics,
  receiveBrowserLoadReport,
} from "./browser-connection-diagnostics.js";

let entries: ServerLogEntry[];
let unsubscribe: () => void;
const sockets: { send: () => number }[] = [];
function socket() {
  const value = { send: () => 1 };
  sockets.push(value);
  return value;
}
function report(): BrowserLoadReport {
  return {
    documentId: "ae8bdd9b-7338-4507-bf27-4d6e9272a41a",
    lifecycleId: 0,
    lifecycle: "startup",
    timeOrigin: 1789325520000,
    startedAtMs: 5,
    moduleStartedAtMs: 5,
    displayMode: "standalone",
    visibility: "visible",
    frontendBuildId: "development",
    stages: [{ stage: "feed_frame", atMs: 20000, view: "q-12", loading: false, windowHash: "abcdef" }],
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  entries = [];
  unsubscribe = subscribeToServerLogs({ components: ["browser-load"] }, (entry) => entries.push(entry));
});
afterEach(() => {
  for (const ws of sockets.splice(0)) closeBrowserConnectionDiagnostics(ws);
  unsubscribe();
  vi.useRealTimers();
});

it("retains validated frontend stages under exact socket and server-owned session identity", () => {
  // Even two sockets for the same session cannot submit each other's document observations.
  const first = socket(),
    second = socket();
  const firstId = openBrowserConnectionDiagnostics(first, "owner");
  const secondId = openBrowserConnectionDiagnostics(second, "owner");
  receiveBrowserLoadReport(second, firstId, report());
  expect(entries).toEqual([]);
  receiveBrowserLoadReport(first, firstId, report());
  receiveBrowserLoadReport(second, secondId, report());
  expect(entries.map((entry) => entry.meta?.connectionId)).toEqual([firstId, secondId]);
  expect(entries[0]?.sessionId).toBe("owner");
  expect(entries[0]?.meta).toMatchObject({ documentId: report().documentId, stages: report().stages });
  closeBrowserConnectionDiagnostics(first);
  receiveBrowserLoadReport(first, firstId, report());
  expect(entries).toHaveLength(2);
});

it.each([
  { ...report(), content: "private content" },
  { ...report(), documentId: "https://private.example" },
  { ...report(), frontendBuildId: "private\ncontent" },
  { ...report(), stages: [{ stage: "feed_frame", atMs: -1 }] },
  { ...report(), stages: [{ stage: "feed_frame", atMs: Infinity }] },
  { ...report(), stages: [{ stage: "feed_frame", atMs: 1, view: "https://private.example" }] },
  { ...report(), stages: [{ stage: "feed_frame", atMs: 1, text: "private" }] },
  { ...report(), stages: Array.from({ length: 17 }, () => report().stages[0]) },
])("rejects malformed or content-bearing diagnostic metadata", (value) => {
  const ws = socket(),
    id = openBrowserConnectionDiagnostics(ws, "owner");
  receiveBrowserLoadReport(ws, id, value);
  expect(entries).toEqual([]);
});

it("caps accepted stages per physical socket even across client-invented lifecycle resets", () => {
  const ws = socket(),
    id = openBrowserConnectionDiagnostics(ws, "owner");
  for (let i = 0; i < 100; i++) receiveBrowserLoadReport(ws, id, { ...report(), lifecycleId: i });
  expect(entries).toHaveLength(64);
  vi.advanceTimersByTime(90_000);
  receiveBrowserLoadReport(ws, id, { ...report(), lifecycle: "foreground" });
  expect(entries).toHaveLength(65);
});
