/**
 * Concrete runtime backend of a session. Claude always runs through the Agent
 * SDK; the legacy native `--sdk-url` WebSocket backend was retired (see
 * docs/claude-backend.md).
 */
export type BackendType = "codex" | "claude-sdk";

/** True for backends using Claude Code. */
export function isClaudeFamily(backend: BackendType): boolean {
  return backend === "claude-sdk";
}

/**
 * Parse a backend selection from an API, CLI or settings input. The Claude
 * family name `"claude"` and the concrete `"claude-sdk"` both select the SDK
 * backend; unknown values return null so callers can reject them.
 */
export function parseBackendSelection(raw: unknown): BackendType | null {
  if (raw === "codex") return "codex";
  if (raw === "claude" || raw === "claude-sdk") return "claude-sdk";
  return null;
}

/**
 * Normalize a persisted backend type. Records written before the WebSocket
 * retirement may say `"claude"` or omit the field (the old default); both now
 * resume through the SDK using the same Claude session ID.
 */
export function normalizePersistedBackendType(raw: unknown): BackendType {
  return raw === "codex" ? "codex" : "claude-sdk";
}
