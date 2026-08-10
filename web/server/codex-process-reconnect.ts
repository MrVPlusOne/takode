/** Maximum Codex process launches in one automatic or manual reconnect cycle. */
export const CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS = 5;

/** Overall provider-result reconnect window retained from the resilient recovery policy. */
export const CODEX_PROVIDER_RESULT_RECONNECT_TIMEOUT_MS = 6 * 60_000;

/**
 * Four waits place attempts 2-5 at 30s, 90s, 180s, and 300s.
 * The final attempt therefore still has one minute inside the six-minute cycle.
 */
const CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS = [30_000, 60_000, 90_000, 120_000] as const;

export function codexProviderResultReconnectRetryDelayMs(failedAttempt: number): number {
  const index = Math.max(0, Math.floor(failedAttempt) - 1);
  return (
    CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS[index] ?? CODEX_PROVIDER_RESULT_RECONNECT_RETRY_DELAYS_MS.at(-1)!
  );
}
