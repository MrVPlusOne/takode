/** Sender of the notice that continues a Claude turn after the provider cut a 10-minute request and Takode lowered its effort. */
export const CLAUDE_REQUEST_CUT_SOURCE = {
  sessionId: "system:claude-request-cut",
  sessionLabel: "Request cut off",
} as const;

/** The notice Claude gets (and the feed shows) when a cut request's turn continues at a lower effort. */
export function claudeRequestCutNotice(from: string, to: string): string {
  return (
    `[Request cut off] Your last model request ran for over 10 minutes and the provider cut it off, so its output was lost. ` +
    `Takode lowered your reasoning effort from ${from} to ${to} for the rest of this turn so the next request ` +
    `can finish in time; it returns to normal when the turn ends. Continue the work from where you left off. ` +
    `Do not repeat steps that already completed.`
  );
}

/** The effort change a request-cut notice names, or null when the text does not have it. */
export function parseClaudeRequestCutNotice(content: string): { from: string; to: string } | null {
  const match = content.match(/effort from (\w+) to (\w+)/);
  return match ? { from: match[1], to: match[2] } : null;
}
