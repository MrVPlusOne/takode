export function formatContextWindowLabel(tokenCount: number): string {
  return `${Math.round(tokenCount / 1_000)} K tokens`;
}
