import type { QuestTitlePreview, QuestmasterTask } from "../quest-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { WsBridge } from "../ws-bridge.js";
import { questSources } from "../quest-source-index.js";

export function buildQuestTitlePreview(quest: QuestmasterTask): QuestTitlePreview {
  return {
    questId: quest.questId,
    title: quest.title,
    version: quest.version,
    updatedAt: Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0),
    commitShas: [...(quest.commitShas ?? [])],
  };
}

/**
 * After a quest's source message was recorded: remember it for the leader tab projection
 * and refresh the tabs that show the quest, which can now read as a side quest.
 */
export function recordQuestSource(wsBridge: WsBridge, quest: QuestmasterTask): void {
  if (questSources.record([quest])) wsBridge.invalidateLeaderThreadTabsForQuestIds([quest.questId]);
}

export function broadcastQuestUpdate(wsBridge: WsBridge, quest?: QuestmasterTask): void {
  wsBridge.broadcastGlobal({
    type: "quest_list_updated",
    ...(quest ? { quest: buildQuestTitlePreview(quest) } : {}),
  } satisfies BrowserIncomingMessage);
}
