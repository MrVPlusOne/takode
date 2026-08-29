/** Official Codex classification for an assistant message item. */
export type CodexMessagePhase = "commentary" | "final_answer";

/**
 * Keep only the explicit app-server classifications that Codex documents.
 * Missing, null, and future/unknown values remain unannotated so legacy
 * compatibility behavior can apply without guessing message intent.
 */
export function normalizeCodexMessagePhase(value: unknown): CodexMessagePhase | undefined {
  return value === "commentary" || value === "final_answer" ? value : undefined;
}
