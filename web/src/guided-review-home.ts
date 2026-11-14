import { api } from "./api.js";
import { applyRemoteDraftChange } from "./draft-sync.js";
import type { GuidedReviewTarget } from "./guided-review-state.js";

/**
 * The review a card shows, pointed at where its answers are kept and sent (the thread that last
 * shared it, else where it was published), with the answers saved there put into this tab. The
 * same review shown in its publisher's feed, a leader's share or the Library resolves to the same
 * place from each, so it has one set of answers and is sent once.
 */
export async function resolveGuidedReview(shown: GuidedReviewTarget): Promise<GuidedReviewTarget> {
  const { reviewId } = shown.meta;
  const found = await api.getGuidedReviewHome(shown.sessionId, reviewId);
  // A review the server doesn't know (such as the Playground's) was never shared anywhere.
  if (!found) return shown;
  const { home, answers } = found;
  if (answers) applyRemoteDraftChange(home.sessionId, { kind: "guided-review", reviewId, ...answers });
  const { questId: _shownQuest, ...rest } = shown;
  return {
    ...rest,
    sessionId: home.sessionId,
    threadKey: home.threadKey,
    ...(home.questId ? { questId: home.questId } : {}),
  };
}
