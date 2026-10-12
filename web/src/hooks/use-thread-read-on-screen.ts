import { useEffect, useState } from "react";

/** How long a thread must stay on screen, with the page visible, before its results count as read. */
export const THREAD_READ_DWELL_MS = 2_000;

/**
 * Whether the thread identified by `scopeKey` has been on screen, with the page
 * visible, for at least THREAD_READ_DWELL_MS. Results are marked read only then:
 * a thread shown briefly while a session restores its tab, or one left selected
 * while the page is hidden, has not been looked at.
 */
export function useThreadReadOnScreen(scopeKey: string, enabled: boolean): boolean {
  const [settledScope, setSettledScope] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      setSettledScope(null);
    };
    const start = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => setSettledScope(scopeKey), THREAD_READ_DWELL_MS);
    };
    const onVisibilityChange = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, scopeKey]);

  return enabled && settledScope === scopeKey;
}
