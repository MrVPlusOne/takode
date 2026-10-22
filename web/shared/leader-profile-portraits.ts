import {
  GENERATED_FALLBACK_LEADER_PROFILE_PORTRAIT,
  GENERATED_LEADER_PROFILE_PORTRAITS,
} from "./leader-profile-portraits.generated.js";

export const LEADER_PROFILE_POOL_IDS = ["tako", "shmi", "animals"] as const;

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

// Only pools missing from saved settings take these defaults, so saved choices and assigned portraits stay.
export const DEFAULT_LEADER_PROFILE_POOLS: LeaderProfilePoolSettings = {
  tako: false,
  shmi: false,
  animals: true,
};

/** Picker groups shown collapsed until the user saves a choice of their own. */
export const DEFAULT_LEADER_PROFILE_COLLAPSED_POOLS: LeaderProfilePoolId[] = ["tako", "shmi"];

export const LEADER_PROFILE_POOLS: LeaderProfilePool[] = [
  { id: "tako", label: "Tako" },
  { id: "shmi", label: "Shmi" },
  { id: "animals", label: "Animals" },
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
  return Object.fromEntries(
    LEADER_PROFILE_POOL_IDS.map((id) => [
      id,
      typeof record[id] === "boolean" ? record[id] : DEFAULT_LEADER_PROFILE_POOLS[id],
    ]),
  ) as LeaderProfilePoolSettings;
}

/**
 * Pools collapsed in the portrait picker, in pool order; unknown ids and duplicates are dropped.
 * Anything but a list means no saved choice, which gives the default collapsed groups.
 */
export function normalizeLeaderProfileCollapsedPools(raw: unknown): LeaderProfilePoolId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_LEADER_PROFILE_COLLAPSED_POOLS];
  return LEADER_PROFILE_POOL_IDS.filter((id) => raw.includes(id));
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
