import {
  GENERATED_FALLBACK_LEADER_PROFILE_PORTRAIT,
  GENERATED_LEADER_PROFILE_PORTRAITS,
} from "./leader-profile-portraits.generated.js";

export const LEADER_PROFILE_POOL_IDS = ["tako", "shmi"] as const;

export type LeaderProfilePoolId = (typeof LEADER_PROFILE_POOL_IDS)[number];

export type LeaderProfilePoolSettings = Record<LeaderProfilePoolId, boolean>;

export interface LeaderProfilePool {
  id: LeaderProfilePoolId;
  label: string;
}

export interface LeaderProfilePortrait {
  id: string;
  poolId: LeaderProfilePoolId | "fallback";
  label: string;
  smallUrl: string;
  largeUrl: string;
  smallSize: number;
  largeSize: number;
  smallBytes: number;
  largeBytes: number;
}

export const DEFAULT_LEADER_PROFILE_POOLS: LeaderProfilePoolSettings = {
  tako: true,
  shmi: true,
};

export const LEADER_PROFILE_POOLS: LeaderProfilePool[] = [
  { id: "tako", label: "Tako" },
  { id: "shmi", label: "Shmi" },
];

export const LEADER_PROFILE_PORTRAITS: LeaderProfilePortrait[] = GENERATED_LEADER_PROFILE_PORTRAITS;

export const FALLBACK_LEADER_PROFILE_PORTRAIT: LeaderProfilePortrait = GENERATED_FALLBACK_LEADER_PROFILE_PORTRAIT;

const LEGACY_SHEET_PORTRAIT_ID_ALIASES: Record<string, string> = {
  tako1: "tako1-01",
  tako2: "tako2-01",
  tako3: "tako3-01",
  shmi1: "shmi1-01",
  shmi2: "shmi2-01",
  shmi3: "shmi3-01",
};

export function normalizeLeaderProfilePoolSettings(raw: unknown): LeaderProfilePoolSettings {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    tako: typeof record.tako === "boolean" ? record.tako : DEFAULT_LEADER_PROFILE_POOLS.tako,
    shmi: typeof record.shmi === "boolean" ? record.shmi : DEFAULT_LEADER_PROFILE_POOLS.shmi,
  };
}

export function getLeaderProfilePortrait(id: string | null | undefined): LeaderProfilePortrait | null {
  if (!id || id === FALLBACK_LEADER_PROFILE_PORTRAIT.id) return null;
  const normalizedId = normalizeLeaderProfilePortraitId(id);
  return LEADER_PROFILE_PORTRAITS.find((portrait) => portrait.id === normalizedId) ?? null;
}

export function normalizeLeaderProfilePortraitId(id: string): string {
  return LEGACY_SHEET_PORTRAIT_ID_ALIASES[id] ?? id;
}

export function isLeaderProfilePortraitId(id: string): boolean {
  return LEADER_PROFILE_PORTRAITS.some((portrait) => portrait.id === id);
}

export function getEnabledLeaderProfilePortraits(settings: LeaderProfilePoolSettings): LeaderProfilePortrait[] {
  return LEADER_PROFILE_PORTRAITS.filter((portrait) => settings[portrait.poolId as LeaderProfilePoolId]);
}
