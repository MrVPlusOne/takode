import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecentAskBundles } from "./recent-asks.js";

afterEach(() => vi.restoreAllMocks());

describe("fetchRecentAskBundles", () => {
  it("requests the bounded recent projection with filters and Session Space", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [],
          totalMatches: 0,
          totalRecentGroups: 0,
          limit: 50,
          query: "",
          filter: "active",
          sessionSpaceId: "work",
          attentionCount: 0,
          sessionSpaces: [],
          tookMs: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await fetchRecentAskBundles({ filter: "active", sessionSpaceId: "work" });

    expect(response).toMatchObject({ query: "", totalRecentGroups: 0, limit: 50 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/recent-asks?filter=active&sessionSpaceId=work&limit=50",
      expect.objectContaining({ signal: undefined }),
    );
  });
});
