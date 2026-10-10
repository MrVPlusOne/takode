/**
 * Leader quest tabs can outlive the leader's own work on a quest: after a
 * leader-to-leader handoff the tab stays, but another leader's board now runs
 * the quest. These helpers label such tabs and their quest header so they do
 * not read as this leader's active work.
 */
import type { LeaderThreadTabsProjectionOwnership } from "../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../store.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { SessionHostBadge } from "./HostBadge.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";

export type QuestThreadOwnership = LeaderThreadTabsProjectionOwnership;

/** Short tab detail for a quest this leader does not run, or undefined for its own quests. */
export function questThreadOwnershipLabel(
  ownership: QuestThreadOwnership | null | undefined,
  leaderSessionNum: number | null | undefined,
): string | undefined {
  if (ownership === "other-leader") {
    return leaderSessionNum != null ? `Led by #${leaderSessionNum}` : "Led by another leader";
  }
  if (ownership === "off-board") return "Not on board";
  return undefined;
}

type StoreState = ReturnType<typeof useStore.getState>;

/**
 * Whether Questmaster's loaded record shows the quest finished. A finished quest
 * already reads as done, so "Not on board" would only add noise to it.
 */
export function isLoadedQuestDone(state: StoreState, questId: string | null | undefined): boolean {
  if (!questId) return false;
  const key = normalizeThreadKey(questId);
  const quest =
    state.questDetails?.get(key) ?? state.quests.find((candidate) => normalizeThreadKey(candidate.questId) === key);
  return isCompletedJourneyPresentationStatus(quest?.status);
}

export function useSessionNum(sessionId: string | null | undefined): number | null {
  return useStore((state) =>
    sessionId ? (state.sdkSessions.find((session) => session.sessionId === sessionId)?.sessionNum ?? null) : null,
  );
}

const OWNERSHIP_CHIP_CLASS =
  "inline-flex h-5 min-w-0 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-cc-border/70 bg-transparent px-1.5 text-[10px] leading-none text-cc-muted";

/** Quest header chip naming the leader that now runs the quest, or noting that no board holds it. */
export function QuestThreadOwnershipChip({
  ownership,
  leaderSessionId,
  fallbackLeaderSessionNum,
  questId,
}: {
  ownership: QuestThreadOwnership | null | undefined;
  leaderSessionId?: string | null;
  fallbackLeaderSessionNum?: number | null;
  questId?: string;
}) {
  const leaderSessionNum =
    useSessionNum(ownership === "other-leader" ? leaderSessionId : null) ?? fallbackLeaderSessionNum ?? null;
  const questDone = useStore((state) => ownership === "off-board" && isLoadedQuestDone(state, questId));
  if (ownership === "off-board") {
    if (questDone) return null;
    return (
      <span
        className={OWNERSHIP_CHIP_CLASS}
        data-testid="quest-thread-ownership-chip"
        data-ownership="off-board"
        title="No leader's work board has this quest"
      >
        Not on board
      </span>
    );
  }
  if (ownership !== "other-leader") return null;
  const sessionLabel = leaderSessionNum != null ? `#${leaderSessionNum}` : "another leader";
  return (
    <SessionInlineLink
      sessionId={leaderSessionId ?? null}
      sessionNum={leaderSessionNum}
      threadKey={questId}
      className={`${OWNERSHIP_CHIP_CLASS} transition-colors hover:border-cc-primary/45 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50`}
      dataTestId="quest-thread-ownership-chip"
      ariaLabel={`Led by leader ${sessionLabel}`}
      title={`Another leader now runs this quest. Open leader session ${sessionLabel}`}
    >
      <SessionRoleIcon role="Leader" />
      {/* The leader icon and number carry the meaning when a very narrow header needs the room. */}
      <span className="shrink-0 max-[379px]:hidden">Led by</span>
      <span className="shrink-0 font-mono-code text-cc-attention">{sessionLabel}</span>
      {leaderSessionId && <SessionHostBadge sessionId={leaderSessionId} />}
    </SessionInlineLink>
  );
}
