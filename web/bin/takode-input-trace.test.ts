import { afterEach, expect, it, vi } from "vitest";
const apiGet = vi.hoisted(() => vi.fn());
vi.mock("./takode-core.js", async (original) => ({ ...(await original<typeof import("./takode-core.js")>()), apiGet }));
import { handleInputTrace } from "./takode-input-trace.js";
afterEach(() => {
  vi.restoreAllMocks();
  apiGet.mockReset();
});

it("lists recordings without event payloads, then requests events explicitly by prefix and range", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  apiGet.mockResolvedValueOnce({
    traces: [{ trace: "aaaaaaaa", platform: "MacIntel", eventCount: 10000, firstEventAt: 1, lastEventAt: 1000 }],
  });
  await handleInputTrace("base", []);
  expect(log.mock.calls.flat().join("\n")).toContain("10000 events");
  expect(apiGet).toHaveBeenLastCalledWith("base", "/diagnostics/input-trace?");
  apiGet.mockResolvedValueOnce({
    trace: "aaaaaaaa",
    matchingEvents: 1,
    events: [{ t: 1000, seq: 2, type: "paste", length: 33 }],
  });
  await handleInputTrace("base", ["aaaaaaaa", "--since", "5m", "--limit", "1", "--json"]);
  expect(apiGet).toHaveBeenLastCalledWith("base", "/diagnostics/input-trace?trace=aaaaaaaa&since=5m&limit=1");
  expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).events).toHaveLength(1);
});
