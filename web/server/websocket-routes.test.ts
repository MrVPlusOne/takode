import { describe, expect, it } from "vitest";
import { matchWebSocketRoute } from "./websocket-routes.js";

describe("websocket route matching", () => {
  it("accepts non-hex browser session ids returned by persisted session state", () => {
    // Archived/imported fixture sessions can be restored from persisted state
    // with non-UUID ids; browser history viewing should still be able to open
    // the session WebSocket and subscribe to persisted history.
    expect(matchWebSocketRoute("/ws/browser/q1603-archived-session")).toEqual({
      kind: "browser",
      sessionId: "q1603-archived-session",
    });
  });

  it("keeps CLI and terminal routes constrained to UUID-like ids", () => {
    expect(matchWebSocketRoute("/ws/cli/q1603-archived-session")).toBeNull();
    expect(matchWebSocketRoute("/ws/terminal/q1603-archived-session")).toBeNull();
    expect(matchWebSocketRoute("/ws/cli/abc123-456")).toEqual({ kind: "cli", sessionId: "abc123-456" });
    expect(matchWebSocketRoute("/ws/terminal/abc123-456")).toEqual({ kind: "terminal", terminalId: "abc123-456" });
  });

  it("rejects empty, nested, or slash-decoded browser ids", () => {
    expect(matchWebSocketRoute("/ws/browser/")).toBeNull();
    expect(matchWebSocketRoute("/ws/browser/a/b")).toBeNull();
    expect(matchWebSocketRoute("/ws/browser/a%2Fb")).toBeNull();
  });
});
