import { useQuestDetailRecord } from "../useQuestDetailRecord.js";
import { QuestPreviewCardContent, QuestPreviewHeaderAction } from "../QuestPreviewCardContent.js";
import { openQuestOverlayRouteAware } from "../../utils/routing.js";

/**
 * A quest's details in the side column, as its link's preview shows them (status, Journey,
 * description, its worker and thread), with Open quest for the full view.
 */
export function SideQuest({ questId }: { questId: string }) {
  const { quest, questLoading, questLoadError } = useQuestDetailRecord(questId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="side-quest" data-quest-id={questId}>
      {quest ? (
        <QuestPreviewCardContent
          quest={quest}
          headerAction={
            <QuestPreviewHeaderAction
              label="Open quest"
              ariaLabel={`Open ${questId}`}
              onActivate={() => openQuestOverlayRouteAware(questId)}
            />
          }
        />
      ) : (
        <p className="text-[13px] text-cc-muted">
          {questLoadError ? `${questId} could not be loaded.` : questLoading ? "Loading…" : `${questId} not found.`}
        </p>
      )}
    </div>
  );
}
