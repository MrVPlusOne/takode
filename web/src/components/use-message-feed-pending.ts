import { useMemo } from "react";
import { useStore } from "../store.js";
import { filterPendingCodexInputsForThread, filterPendingUserUploadsForThread } from "../utils/thread-projection.js";
import { EMPTY_PENDING_CODEX_INPUTS, EMPTY_PENDING_USER_UPLOADS } from "./message-feed-utils.js";

/** Selects one canonical, owner-scoped pending representation for the active feed. */
export function useMessageFeedPending(sessionId: string, threadKey: string) {
  const allPendingUserUploads = useStore(
    (state) => state.pendingUserUploads.get(sessionId) ?? EMPTY_PENDING_USER_UPLOADS,
  );
  const allPendingCodexInputs = useStore(
    (state) => state.pendingCodexInputs.get(sessionId) ?? EMPTY_PENDING_CODEX_INPUTS,
  );

  return useMemo(() => {
    const serverOwnedClientMsgIds = new Set(
      allPendingCodexInputs.flatMap((input) => (input.clientMsgId ? [input.clientMsgId] : [])),
    );
    return {
      pendingCodexInputs: filterPendingCodexInputsForThread(allPendingCodexInputs, threadKey),
      pendingUserUploads: filterPendingUserUploadsForThread(allPendingUserUploads, threadKey).filter(
        (upload) => !serverOwnedClientMsgIds.has(upload.id),
      ),
    };
  }, [allPendingCodexInputs, allPendingUserUploads, threadKey]);
}
