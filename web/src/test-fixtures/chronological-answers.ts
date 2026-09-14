import { buildThreadWindowSync } from "../../shared/thread-window.js";
import type { BrowserIncomingMessage, LeaderThreadResponseProjection } from "../types.js";
import snapshot from "./chronological-answers.json";

// Synthetic history finalized by the server producer. Its conformance test
// rebuilds both projections so browser fixtures cannot invent answer authority.
export const chronologicalAnswersFixture = snapshot as {
  sessionId: string;
  threadKey: string;
  history: BrowserIncomingMessage[];
  projections: Record<string, LeaderThreadResponseProjection>;
};

export function buildChronologicalAnswersWindow(threadKey: string, itemCount = snapshot.history.length) {
  return buildThreadWindowSync({
    messageHistory: chronologicalAnswersFixture.history,
    currentThreadResponseProjection: chronologicalAnswersFixture.projections[threadKey],
    threadKey,
    fromItem: -1,
    itemCount,
    sectionItemCount: itemCount,
    visibleItemCount: 1,
  });
}
