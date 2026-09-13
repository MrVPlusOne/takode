import { useLayoutEffect } from "react";
import { useStore } from "../store.js";
import { browserLoadDiagnostics } from "../utils/browser-load-diagnostics.js";

/** Sample committed selected-view metadata without subscribing or changing feed state. */
export function useFeedLoadTiming(sessionId: string, threadKey: string, loading: boolean): void {
  const state = useStore.getState();
  const window =
    state.threadWindows?.get(sessionId)?.get(threadKey) ??
    (threadKey === "main" || threadKey === "all" ? state.historyWindows?.get(sessionId) : undefined);
  useLayoutEffect(() => {
    browserLoadDiagnostics.feedCommitted(sessionId, threadKey, loading, window?.window_hash);
  });
}
