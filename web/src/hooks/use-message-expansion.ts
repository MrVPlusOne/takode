import { useCallback, useState } from "react";
import { setMessageExpanded } from "../api/message-expansion.js";
import { useStore } from "../store.js";

/**
 * Whether a message's long content (a report, a long user message) is expanded, and how to
 * change it. With a session and a stable message ID the state is the session's, kept on the
 * server and shared by every browser: a change shows once the server sends it back. Without
 * them (a message still sending, an old history entry with no stable ID) the state is local,
 * as it also becomes if the server cannot be reached.
 */
export function useMessageExpansion(
  sessionId: string | undefined,
  messageId: string | null | undefined,
): [expanded: boolean, setExpanded: (expanded: boolean) => void] {
  const synced = Boolean(sessionId && messageId);
  const serverExpanded = useStore((s) =>
    synced ? Boolean(s.sessions.get(sessionId!)?.expandedMessages?.[messageId!]) : false,
  );
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  // A later state from the server replaces a local fallback.
  const [lastServerExpanded, setLastServerExpanded] = useState(serverExpanded);
  if (lastServerExpanded !== serverExpanded) {
    setLastServerExpanded(serverExpanded);
    setLocalExpanded(null);
  }

  const setExpanded = useCallback(
    (expanded: boolean) => {
      if (!sessionId || !messageId) {
        setLocalExpanded(expanded);
        return;
      }
      setMessageExpanded(sessionId, messageId, expanded).catch((error: unknown) => {
        console.warn("[message-expansion] could not save; showing the change here only", error);
        setLocalExpanded(expanded);
      });
    },
    [messageId, sessionId],
  );

  return [localExpanded ?? serverExpanded, setExpanded];
}
