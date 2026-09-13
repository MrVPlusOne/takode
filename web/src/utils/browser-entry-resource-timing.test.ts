// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BROWSER_ENTRY_RESOURCE_MAX_BYTES } from "../../shared/browser-load-diagnostics.js";
import { readBrowserEntryResources } from "./browser-entry-resource-timing.js";

const timing = {
  startTime: 600,
  fetchStart: 600,
  requestStart: 620,
  responseStart: 700,
  responseEnd: 6600,
  duration: 6000,
  transferSize: 123456,
  encodedBodySize: 123000,
  decodedBodySize: 3700000,
};
beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(7000);
  document.head.innerHTML =
    '<script type="module" src="/assets/entry.js?private=secret"></script><link rel="stylesheet" href="/assets/entry.css">';
});
afterEach(() => {
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reads only exact same-origin document entries and projects numeric fields without URLs", () => {
  // Unrelated network traffic and content-bearing fields never enter the summary.
  document.head.insertAdjacentHTML(
    "beforeend",
    '<script type="module" src="https://external.example/secret.js"></script>',
  );
  const read = vi.spyOn(performance, "getEntriesByName").mockImplementation((name) => [
    {
      ...timing,
      name,
      entryType: "resource",
      serverTiming: [{ description: "private" }],
    } as unknown as PerformanceEntry,
  ]);
  const result = readBrowserEntryResources(6871);
  expect(result).toEqual({
    status: "complete",
    resources: [
      { role: "entry_script", status: "available", timings: timing },
      { role: "entry_stylesheet", status: "available", timings: timing },
    ],
  });
  expect(read.mock.calls).toEqual([
    [`${window.location.origin}/assets/entry.js?private=secret`, "resource"],
    [`${window.location.origin}/assets/entry.css`, "resource"],
  ]);
  expect(JSON.stringify(result)).not.toMatch(/secret|private|https|name|serverTiming/);
});

it("preserves missing and ambiguous entries instead of selecting a convenient fetch", () => {
  // A reused URL can have multiple fetches; no synthetic fastest/latest choice is authoritative.
  vi.spyOn(performance, "getEntriesByName").mockImplementation((name) =>
    name.includes(".js") ? ([timing, timing] as unknown as PerformanceEntry[]) : [],
  );
  expect(readBrowserEntryResources(6871)).toEqual({
    status: "incomplete",
    resources: [
      { role: "entry_script", status: "ambiguous" },
      { role: "entry_stylesheet", status: "missing" },
    ],
  });
});

it("keeps valid zeros while exposing unavailable or invalid fields as partial", () => {
  // Zero byte sizes are retained without claiming a cache hit; unsupported fields stay absent.
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([
    {
      ...timing,
      transferSize: 0,
      encodedBodySize: undefined,
      decodedBodySize: Infinity,
      requestStart: -1,
    } as unknown as PerformanceEntry,
  ]);
  const result = readBrowserEntryResources(6871);
  expect(result.status).toBe("incomplete");
  expect(result.resources[0]).toMatchObject({ status: "partial", timings: { transferSize: 0, responseEnd: 6600 } });
  expect(result.resources[0]!.timings).not.toHaveProperty("encodedBodySize");
  expect(result.resources[0]!.timings).not.toHaveProperty("decodedBodySize");
  expect(result.resources[0]!.timings).not.toHaveProperty("requestStart");
});

it("marks missing document roles and excessive entry references as incomplete", () => {
  const read = vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
  document.head.innerHTML = "";
  expect(readBrowserEntryResources(6871)).toEqual({
    status: "incomplete",
    resources: [
      { role: "entry_script", status: "missing" },
      { role: "entry_stylesheet", status: "missing" },
    ],
  });
  document.head.innerHTML = Array.from(
    { length: 5 },
    (_, i) => `<script type="module" src="/entry-${i}.js"></script>`,
  ).join("");
  expect(readBrowserEntryResources(6871)).toEqual({ status: "ambiguous", resources: [] });
  expect(read).not.toHaveBeenCalled();
});

it("does not read expired or unsupported captures", () => {
  const read = vi.spyOn(performance, "getEntriesByName").mockImplementation(() => {
    throw new Error("unsupported");
  });
  expect(readBrowserEntryResources(0)).toEqual({ status: "unsupported", resources: [] });
  read.mockClear();
  vi.spyOn(performance, "now").mockReturnValue(90001);
  expect(readBrowserEntryResources(0)).toEqual({ status: "expired", resources: [] });
  expect(read).not.toHaveBeenCalled();
  vi.stubGlobal("performance", { now: () => 10 });
  expect(readBrowserEntryResources(0)).toEqual({ status: "unsupported", resources: [] });
});

it("bounds even maximum numeric metadata below the document byte budget", () => {
  document.head.insertAdjacentHTML(
    "beforeend",
    '<script type="module" src="/extra.js"></script><link rel="stylesheet" href="/extra.css">',
  );
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([
    Object.fromEntries(Object.keys(timing).map((key) => [key, Number.MAX_SAFE_INTEGER])) as unknown as PerformanceEntry,
  ]);
  const entryResources = readBrowserEntryResources(6871);
  expect(entryResources.resources).toHaveLength(4);
  expect(
    new TextEncoder().encode(JSON.stringify({ stage: "entry_resources", atMs: 7000, entryResources })).byteLength,
  ).toBeLessThanOrEqual(BROWSER_ENTRY_RESOURCE_MAX_BYTES);
});
