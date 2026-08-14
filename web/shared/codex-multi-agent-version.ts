export const CODEX_MULTI_AGENT_VERSIONS = ["v1", "v2"] as const;

export type CodexMultiAgentVersion = (typeof CODEX_MULTI_AGENT_VERSIONS)[number];

/** V1 remains the compatibility behavior when no worker-only V2 selection is present. */
export const DEFAULT_CODEX_MULTI_AGENT_VERSION: CodexMultiAgentVersion = "v1";

export function isCodexMultiAgentVersion(value: unknown): value is CodexMultiAgentVersion {
  return typeof value === "string" && CODEX_MULTI_AGENT_VERSIONS.includes(value as CodexMultiAgentVersion);
}

export function normalizeCodexMultiAgentVersion(
  value: unknown,
  fallback: CodexMultiAgentVersion = DEFAULT_CODEX_MULTI_AGENT_VERSION,
): CodexMultiAgentVersion {
  return isCodexMultiAgentVersion(value) ? value : fallback;
}
