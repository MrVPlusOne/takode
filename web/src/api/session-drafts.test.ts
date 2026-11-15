import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSlackRefresh } from "./session-drafts.js";

describe("requestSlackRefresh", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks the server at most once a minute per session", () => {
    // Showing and focusing question cards calls this often; the server would
    // skip conversations checked within the minute anyway.
    requestSlackRefresh("s1");
    requestSlackRefresh("s1");
    requestSlackRefresh("s2");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/sessions/s1/slack-refresh",
      "/api/sessions/s2/slack-refresh",
    ]);
    vi.advanceTimersByTime(60_000);
    requestSlackRefresh("s1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1]).toEqual({ method: "POST" });
  });
});
