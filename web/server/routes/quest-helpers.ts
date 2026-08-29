import type { QuestTitlePreview, QuestmasterTask } from "../quest-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { WsBridge } from "../ws-bridge.js";

export function buildQuestTitlePreview(quest: QuestmasterTask): QuestTitlePreview {
  return {
    questId: quest.questId,
    title: quest.title,
    version: quest.version,
    updatedAt: Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0),
    commitShas: [...(quest.commitShas ?? [])],
  };
}

export function broadcastQuestUpdate(wsBridge: WsBridge, quest?: QuestmasterTask): void {
  wsBridge.broadcastGlobal({
    type: "quest_list_updated",
    ...(quest ? { quest: buildQuestTitlePreview(quest) } : {}),
  } satisfies BrowserIncomingMessage);
}
