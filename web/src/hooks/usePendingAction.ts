import { useCallback, useEffect, useRef, useState } from "react";

/** State and runner returned by {@link usePendingAction}. */
export interface PendingAction {
  /** True from the moment `run` starts until its action settles. */
  pending: boolean;
  /** Message of the last failure, or null. The next run clears it. */
  error: string | null;
  /**
   * Runs `action` unless one is already running, so a second press cannot
   * submit twice. Resolves true when the action succeeded and false when it
   * failed or was skipped; failures land in `error` instead of throwing.
   */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  clearError: () => void;
}

/**
 * Tracks one server action started by a button, so the button can show it is
 * waiting (`aria-busy={pending}` gives the shared pending look) and report a
 * failure instead of silently doing nothing. `failure` prefixes the error
 * message, for example "Reply failed."; failures are also logged, for callers
 * with no room to show them.
 */
export function usePendingAction(failure: string): PendingAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setPending(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (err) {
        console.warn(`[pending-action] ${failure}`, err);
        if (mountedRef.current)
          setError(`${failure} ${err instanceof Error && err.message ? err.message : "Please retry."}`);
        return false;
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    },
    [failure],
  );
  const clearError = useCallback(() => setError(null), []);
  return { pending, error, run, clearError };
}
