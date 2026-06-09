import { normalizeMemorySessionSpaceSlug } from "./memory-session-space.js";
import type { QuestmasterTask } from "./quest-types.js";
import { getActiveSessionId, getLeaderSessionId, getPreviousOwnerSessionIds } from "./quest-store-helpers.js";

export type QuestSessionSpaceResolver = (sessionId: string) => string | null | undefined;

export function normalizeQuestSessionSpaceSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? normalizeMemorySessionSpaceSlug(trimmed) : undefined;
}

export function questSessionSpaceProvenanceSessionIds(quest: QuestmasterTask): string[] {
  const seen = new Set<string>();
  const sessionIds: string[] = [];
  const add = (sessionId: string | undefined) => {
    const normalized = sessionId?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    sessionIds.push(normalized);
  };

  add(getActiveSessionId(quest));
  for (const sessionId of getPreviousOwnerSessionIds(quest)) add(sessionId);
  add(getLeaderSessionId(quest));
  for (const run of quest.journeyRuns ?? []) {
    add(run.workerSessionId);
    add(run.leaderSessionId);
    for (const occurrence of run.phaseOccurrences) add(occurrence.assigneeSessionId);
  }
  for (const event of quest.ownershipEvents ?? []) {
    add(event.actorSessionId);
    add(event.previousOwnerSessionId);
    add(event.newOwnerSessionId);
    add(event.previousLeaderSessionId);
    add(event.newLeaderSessionId);
  }

  return sessionIds;
}

export function getQuestSessionSpaceCandidates(
  quest: QuestmasterTask,
  options: {
    resolveSessionSpaceSlug?: QuestSessionSpaceResolver;
    defaultSessionSpaceSlug?: string | null | undefined;
  } = {},
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (slug: unknown) => {
    const normalized = normalizeQuestSessionSpaceSlug(slug);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  add(quest.sessionSpaceSlug);
  if (options.resolveSessionSpaceSlug) {
    for (const sessionId of questSessionSpaceProvenanceSessionIds(quest)) {
      add(options.resolveSessionSpaceSlug(sessionId));
    }
  }
  add(options.defaultSessionSpaceSlug);

  return candidates;
}

export function getQuestSessionSpaceSlug(
  quest: QuestmasterTask,
  options?: {
    resolveSessionSpaceSlug?: QuestSessionSpaceResolver;
    defaultSessionSpaceSlug?: string | null | undefined;
  },
): string | undefined {
  return getQuestSessionSpaceCandidates(quest, options)[0];
}
