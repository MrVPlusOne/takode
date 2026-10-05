import { describe, expect, it } from "vitest";
import { normalizePersistedBackendType, parseBackendSelection } from "./backend-type.js";

describe("backend selection", () => {
  it("accepts the Claude family name and the concrete SDK type as Claude SDK", () => {
    // API, CLI and cron inputs say "claude"; both spellings launch the only Claude backend.
    expect(parseBackendSelection("claude")).toBe("claude-sdk");
    expect(parseBackendSelection("claude-sdk")).toBe("claude-sdk");
    expect(parseBackendSelection("codex")).toBe("codex");
  });

  it("rejects unknown backend inputs so callers can return an error", () => {
    expect(parseBackendSelection("openai")).toBeNull();
    expect(parseBackendSelection(undefined)).toBeNull();
  });

  it("loads sessions saved by the retired WebSocket backend as Claude SDK sessions", () => {
    // Older records say "claude" or omit the type (the old default); both resume
    // through the SDK with the same Claude session ID.
    expect(normalizePersistedBackendType("claude")).toBe("claude-sdk");
    expect(normalizePersistedBackendType(undefined)).toBe("claude-sdk");
    expect(normalizePersistedBackendType("claude-sdk")).toBe("claude-sdk");
    expect(normalizePersistedBackendType("codex")).toBe("codex");
  });
});
