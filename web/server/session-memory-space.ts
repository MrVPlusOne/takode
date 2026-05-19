import { normalizeMemorySessionSpaceSlug } from "./memory-session-space.js";
import type { TreeGroupState } from "./tree-group-store.js";

export interface SessionMemorySpaceSnapshot {
  sessionId: string;
  treeGroupId?: string | null;
  memorySessionSpaceSlug?: string | null;
}

export interface SessionMemorySpaceBackfill {
  sessionId: string;
  treeGroupId: string;
  memorySessionSpaceSlug: string;
}

export function memorySessionSpaceSlugForTreeGroup(
  treeState: Pick<TreeGroupState, "groups">,
  groupId: string | undefined | null,
  fallbackSlug: string,
): string | undefined {
  const normalizedGroupId = normalizeTreeGroupId(groupId);
  if (normalizedGroupId === "default") return normalizeMemorySessionSpaceSlug(fallbackSlug);
  const group = treeState.groups.find((candidate) => candidate.id === normalizedGroupId);
  if (!group) return undefined;
  return normalizeMemorySessionSpaceSlug(group.name);
}

export function memorySessionSpaceSlugsForTreeGroups(
  treeState: Pick<TreeGroupState, "groups">,
  fallbackSlug: string,
): string[] {
  const slugs = new Set<string>([normalizeMemorySessionSpaceSlug(fallbackSlug)]);
  for (const group of treeState.groups) {
    if (group.id === "default") continue;
    slugs.add(normalizeMemorySessionSpaceSlug(group.name));
  }
  return [...slugs];
}

export function planSessionMemorySpaceBackfill(
  sessions: SessionMemorySpaceSnapshot[],
  treeState: Pick<TreeGroupState, "groups">,
  fallbackSlug: string,
): SessionMemorySpaceBackfill[] {
  const updates: SessionMemorySpaceBackfill[] = [];
  for (const session of sessions) {
    const sessionId = session.sessionId.trim();
    if (!sessionId) continue;

    const treeGroupId = normalizeTreeGroupId(session.treeGroupId);
    const memorySessionSpaceSlug = memorySessionSpaceSlugForTreeGroup(treeState, treeGroupId, fallbackSlug);
    if (!memorySessionSpaceSlug) continue;
    const currentSlug = session.memorySessionSpaceSlug?.trim();
    if (currentSlug) {
      const normalizedCurrentSlug = normalizeMemorySessionSpaceSlug(currentSlug);
      if (normalizedCurrentSlug === memorySessionSpaceSlug) continue;
      if (normalizedCurrentSlug !== normalizeMemorySessionSpaceSlug(fallbackSlug)) continue;
    } else if (memorySessionSpaceSlug === normalizeMemorySessionSpaceSlug(fallbackSlug)) {
      continue;
    }

    updates.push({ sessionId, treeGroupId, memorySessionSpaceSlug });
  }
  return updates;
}

function normalizeTreeGroupId(value: string | undefined | null): string {
  return value?.trim() || "default";
}
