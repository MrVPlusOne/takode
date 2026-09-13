import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BROWSER_ENTRY_RESOURCE_FIELDS,
  BROWSER_ENTRY_RESOURCE_MAX_BYTES,
  type BrowserLoadReport,
} from "../../shared/browser-load-diagnostics.js";
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

function resourceReport(): BrowserLoadReport {
  const timings = Object.fromEntries(BROWSER_ENTRY_RESOURCE_FIELDS.map((field) => [field, 10]));
  return {
    ...report(),
    stages: [
      {
        stage: "entry_resources",
        atMs: 7000,
        entryResources: {
          status: "complete",
          resources: [
            { role: "entry_script", status: "available", timings: { ...timings } },
            { role: "entry_stylesheet", status: "available", timings: { ...timings } },
          ],
        },
      },
    ],
  };
}

it("accepts one bounded entry summary per socket budget without disabling ordinary stages", () => {
  const ws = socket(),
    id = openBrowserConnectionDiagnostics(ws, "owner");
  const value = resourceReport();
  expect(Buffer.byteLength(JSON.stringify(value.stages[0]))).toBeLessThanOrEqual(BROWSER_ENTRY_RESOURCE_MAX_BYTES);
  receiveBrowserLoadReport(ws, id, value);
  receiveBrowserLoadReport(ws, id, { ...value, lifecycleId: 20 });
  receiveBrowserLoadReport(ws, id, report());
  expect(entries).toHaveLength(2);
  expect(entries[0]!.meta).toMatchObject({ stages: value.stages, connectionId: id });
  vi.advanceTimersByTime(90000);
  receiveBrowserLoadReport(ws, id, value);
  expect(entries).toHaveLength(3);
});

it("rejects duplicated summaries in one batch without consuming the socket allowance", () => {
  const ws = socket(),
    id = openBrowserConnectionDiagnostics(ws, "owner");
  const value = resourceReport();
  receiveBrowserLoadReport(ws, id, { ...value, stages: [value.stages[0], value.stages[0]] });
  expect(entries).toEqual([]);
  receiveBrowserLoadReport(ws, id, value);
  expect(entries).toHaveLength(1);
});

it.each([
  (value: BrowserLoadReport) => ({ ...value, displayMode: "browser" }),
  (value: BrowserLoadReport) => ({ ...value, lifecycle: "foreground" }),
  (value: BrowserLoadReport) => ({ ...value, stages: [{ ...value.stages[0], atMs: 90006 }] }),
  (value: BrowserLoadReport) => ({ ...value, stages: [{ ...value.stages[0], stage: "feed_frame" }] }),
  (value: BrowserLoadReport) => ({ ...value, stages: [{ stage: "entry_resources", atMs: 5 }] }),
  (value: BrowserLoadReport) => ({
    ...value,
    stages: [
      {
        ...value.stages[0],
        entryResources: {
          status: "expired",
          resources: value.stages[0]!.entryResources!.resources,
        },
      },
    ],
  }),
  (value: BrowserLoadReport) => ({
    ...value,
    stages: [
      {
        ...value.stages[0],
        entryResources: {
          status: "complete",
          resources: Array(5).fill(value.stages[0]!.entryResources!.resources[0]),
        },
      },
    ],
  }),
  (value: BrowserLoadReport) => ({
    ...value,
    stages: [
      {
        ...value.stages[0],
        entryResources: {
          status: "incomplete",
          resources: [{ role: "entry_script", status: "missing", url: "private" }],
        },
      },
    ],
  }),
  (value: BrowserLoadReport) => ({
    ...value,
    stages: [
      {
        ...value.stages[0],
        entryResources: {
          status: "incomplete",
          resources: [{ role: "entry_script", status: "partial", timings: { name: "private" } }],
        },
      },
    ],
  }),
  (value: BrowserLoadReport) => ({
    ...value,
    stages: [
      {
        ...value.stages[0],
        entryResources: {
          status: "incomplete",
          resources: [{ role: "entry_script", status: "partial", timings: { responseEnd: Infinity } }],
        },
      },
    ],
  }),
])("rejects content-bearing, oversized, or misattributed entry timing shapes", (mutate) => {
  const ws = socket(),
    id = openBrowserConnectionDiagnostics(ws, "owner");
  receiveBrowserLoadReport(ws, id, mutate(resourceReport()));
  expect(entries).toEqual([]);
});

it("keeps unsupported fields and expiry explicit, without accepting old foreground resource values", () => {
  const first = socket(),
    firstId = openBrowserConnectionDiagnostics(first, "owner");
  const second = socket(),
    secondId = openBrowserConnectionDiagnostics(second, "owner");
  const incomplete = {
    ...report(),
    stages: [
      {
        stage: "entry_resources",
        atMs: 7000,
        entryResources: {
          status: "incomplete",
          resources: [
            { role: "entry_script", status: "partial", timings: { responseEnd: 6000, transferSize: 0 } },
            { role: "entry_stylesheet", status: "missing" },
          ],
        },
      },
    ],
  };
  receiveBrowserLoadReport(first, firstId, incomplete);
  receiveBrowserLoadReport(second, firstId, incomplete);
  receiveBrowserLoadReport(second, secondId, {
    ...report(),
    lifecycle: "foreground",
    stages: [{ stage: "entry_resources", atMs: 100000, entryResources: { status: "expired", resources: [] } }],
  });
  expect(entries).toHaveLength(2);
  expect(entries[0]!.meta).toMatchObject({ stages: incomplete.stages });
  expect(entries[1]!.meta).toMatchObject({
    lifecycle: "foreground",
    stages: [{ stage: "entry_resources", atMs: 100000, entryResources: { status: "expired", resources: [] } }],
  });
});
