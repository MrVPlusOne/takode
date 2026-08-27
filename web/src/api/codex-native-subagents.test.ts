import type { BrowserIncomingMessage } from "../types.js";
import { CodexNativeSubagentHistoryError, fetchCodexNativeSubagentHistory } from "./codex-native-subagents.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchCodexNativeSubagentHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a bounded page with opaque encoded identifiers and cursor", async () => {
    const message: BrowserIncomingMessage = {
      type: "user_message",
      id: "child-message-1",
      content: "Inspect the producer-shaped child record.",
      timestamp: 1_788_000_000_000,
      history_index: 42,
      codexSubagent: { childId: "child?opaque#id", rootTurnId: "turn-1" },
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        messages: [message],
        nextCursor: "opaque-next",
        availability: "partial",
        coverage: "partial",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCodexNativeSubagentHistory({
      sessionId: "session/with spaces",
      childId: "child?opaque#id",
      cursor: "cursor/next",
      limit: 500,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session%2Fwith%20spaces/codex-native-subagents/child%3Fopaque%23id/history?limit=50&cursor=cursor%2Fnext",
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    );
    expect(result).toEqual({
      messages: [message],
      nextCursor: "opaque-next",
      availability: "partial",
      coverage: "partial",
    });
  });

  it("normalizes a missing next cursor to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [],
          availability: "available",
          coverage: "complete",
        }),
      ),
    );

    await expect(
      fetchCodexNativeSubagentHistory({ sessionId: "session-1", childId: "child-1", limit: 0 }),
    ).resolves.toEqual({
      messages: [],
      nextCursor: null,
      availability: "available",
      coverage: "complete",
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("?limit=1"), expect.any(Object));
  });

  it("does not echo backend error bodies to callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "provider thread 123 at /private/rollout" }, 503)),
    );

    const error = await fetchCodexNativeSubagentHistory({ sessionId: "session-1", childId: "child-1" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CodexNativeSubagentHistoryError);
    expect(error).toMatchObject({ status: 503, message: "Codex subagent history request failed" });
    expect(String(error)).not.toContain("provider thread");
    expect(String(error)).not.toContain("/private/rollout");
  });

  it("rejects records without authoritative child ownership", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [
            {
              type: "user_message",
              id: "unowned-record",
              content: "Legacy flattened activity",
              timestamp: 1_788_000_000_000,
            },
          ],
          nextCursor: null,
          availability: "partial",
          coverage: "partial",
        }),
      ),
    );

    await expect(
      fetchCodexNativeSubagentHistory({ sessionId: "session-1", childId: "selected-child" }),
    ).rejects.toThrow("Invalid Codex subagent history response");
  });

  it("rejects records owned by a different opaque child", async () => {
    // Defense in depth: even a malformed server page must not cross-display
    // content from another native child in the selected inspector.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [
            {
              type: "user_message",
              id: "wrong-child-record",
              content: "Must not cross child boundaries",
              timestamp: 1_788_000_000_000,
              codexSubagent: { childId: "another-child", rootTurnId: "turn-1" },
            },
          ],
          nextCursor: null,
          availability: "available",
          coverage: "complete",
        }),
      ),
    );

    await expect(
      fetchCodexNativeSubagentHistory({ sessionId: "session-1", childId: "selected-child" }),
    ).rejects.toThrow("Invalid Codex subagent history response");
  });

  it("rejects malformed transcript metadata instead of guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [],
          nextCursor: 123,
          availability: "complete",
          coverage: "unknown",
        }),
      ),
    );

    await expect(fetchCodexNativeSubagentHistory({ sessionId: "session-1", childId: "child-1" })).rejects.toThrow(
      "Invalid Codex subagent history response",
    );
  });
});
