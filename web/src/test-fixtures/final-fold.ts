import { buildThreadWindowSync } from "../../shared/thread-window.js";
import type { BrowserIncomingMessage, LeaderThreadResponseProjection } from "../types.js";
import snapshot from "./final-fold.json";

// Synthetic quest-thread history finalized by the server producer: progress notes and worker
// events, the leader's answer, then more work. Its conformance test rebuilds the projection.
export const finalFoldFixture = snapshot as {
  sessionId: string;
  threadKey: string;
  history: BrowserIncomingMessage[];
  projection: LeaderThreadResponseProjection;
};

export function buildFinalFoldWindow() {
  const itemCount = finalFoldFixture.history.length;
  return buildThreadWindowSync({
    messageHistory: finalFoldFixture.history,
    currentThreadResponseProjection: finalFoldFixture.projection,
    threadKey: finalFoldFixture.threadKey,
    fromItem: -1,
    itemCount,
    sectionItemCount: itemCount,
    visibleItemCount: 1,
  });
}
