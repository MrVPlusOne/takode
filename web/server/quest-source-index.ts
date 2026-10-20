import type { QuestStartedFrom, QuestmasterTask } from "./quest-types.js";

/**
 * The user message each quest was filed from (`relationships.startedFrom`), kept in
 * memory so the leader tab projection, which is built synchronously, can tell side
 * quests apart without reading the quest store. Seeded at startup and updated by the
 * routes that record a quest's source.
 */
export class QuestSourceIndex {
  private readonly sources = new Map<string, QuestStartedFrom>();

  /** Records the quests' sources; true when any changed, so their leaders' tabs need refreshing. */
  record(quests: Iterable<Pick<QuestmasterTask, "questId" | "relationships">>): boolean {
    let changed = false;
    for (const quest of quests) {
      const source = quest.relationships?.startedFrom;
      const questId = quest.questId.toLowerCase();
      const known = this.sources.get(questId);
      if (!source || (known?.sessionId === source.sessionId && known.messageId === source.messageId)) continue;
      this.sources.set(questId, source);
      changed = true;
    }
    return changed;
  }

  get(questId: string): QuestStartedFrom | undefined {
    return this.sources.get(questId.toLowerCase());
  }
}

export const questSources = new QuestSourceIndex();
