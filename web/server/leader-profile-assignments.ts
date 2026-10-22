import { createHash, randomInt } from "node:crypto";
import {
  FALLBACK_LEADER_PROFILE_PORTRAIT,
  DEFAULT_LEADER_PROFILE_POOLS,
  getEnabledLeaderProfilePortraits,
  getLeaderProfilePortrait,
  normalizeLeaderProfilePortraitId,
  type LeaderProfilePoolSettings,
  type LeaderProfilePortrait,
} from "../shared/leader-profile-portraits.js";

export interface LeaderProfileSessionRecord {
  sessionId: string;
  isOrchestrator?: boolean;
  archived?: boolean;
  leaderProfilePortraitId?: string | null;
}

export function chooseRandomLeaderProfilePortraitId(
  settings: LeaderProfilePoolSettings | undefined,
): string | undefined {
  const portraits = getEnabledLeaderProfilePortraits(settings ?? DEFAULT_LEADER_PROFILE_POOLS);
  if (portraits.length === 0) return undefined;
  return portraits[randomInt(portraits.length)]?.id;
}

export function getLeaderProfilePortraitForSession(
  session: LeaderProfileSessionRecord,
  settings: LeaderProfilePoolSettings | undefined,
  persistPortraitId?: (portraitId: string) => void,
): LeaderProfilePortrait | undefined {
  if (session.isOrchestrator !== true || session.archived === true) return undefined;

  const existing = getLeaderProfilePortrait(session.leaderProfilePortraitId);
  if (existing) {
    if (session.leaderProfilePortraitId && session.leaderProfilePortraitId !== existing.id) {
      persistPortraitId?.(normalizeLeaderProfilePortraitId(session.leaderProfilePortraitId));
    }
    return existing;
  }

  const portraits = getEnabledLeaderProfilePortraits(settings ?? DEFAULT_LEADER_PROFILE_POOLS);
  if (portraits.length === 0) return FALLBACK_LEADER_PROFILE_PORTRAIT;

  const selected = portraits[stablePortraitIndex(session.sessionId, portraits.length)];
  if (!selected) return FALLBACK_LEADER_PROFILE_PORTRAIT;

  persistPortraitId?.(selected.id);
  return selected;
}

/**
 * Picks a portrait for each session from `portraits`, all different while there are enough. Each starts
 * at its stable hash slot and moves to the next free one, so a re-run over the same sessions agrees.
 */
export function chooseDistinctLeaderProfilePortraitIds(
  sessionIds: string[],
  portraits: LeaderProfilePortrait[],
): Map<string, string> {
  const chosen = new Map<string, string>();
  if (portraits.length === 0) return chosen;
  const used = new Set<number>();
  for (const sessionId of sessionIds) {
    let index = stablePortraitIndex(sessionId, portraits.length);
    while (used.has(index) && used.size < portraits.length) index = (index + 1) % portraits.length;
    used.add(index);
    chosen.set(sessionId, portraits[index].id);
  }
  return chosen;
}

export function getLeaderProfilePortraitById(id: string): LeaderProfilePortrait | undefined {
  return getLeaderProfilePortrait(id) ?? undefined;
}

function stablePortraitIndex(sessionId: string, portraitCount: number): number {
  const digest = createHash("sha256").update(sessionId).digest();
  return digest.readUInt32BE(0) % portraitCount;
}
