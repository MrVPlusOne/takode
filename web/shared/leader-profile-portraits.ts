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

export const LEADER_PROFILE_PORTRAITS: LeaderProfilePortrait[] = [
  {
    id: "tako1",
    poolId: "tako",
    label: "Tako 1",
    smallUrl: "/leader-profile-portraits/tako/tako1.v1.96.webp",
    largeUrl: "/leader-profile-portraits/tako/tako1.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4068,
    largeBytes: 27208,
  },
  {
    id: "tako2",
    poolId: "tako",
    label: "Tako 2",
    smallUrl: "/leader-profile-portraits/tako/tako2.v1.96.webp",
    largeUrl: "/leader-profile-portraits/tako/tako2.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4132,
    largeBytes: 28434,
  },
  {
    id: "tako3",
    poolId: "tako",
    label: "Tako 3",
    smallUrl: "/leader-profile-portraits/tako/tako3.v1.96.webp",
    largeUrl: "/leader-profile-portraits/tako/tako3.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4056,
    largeBytes: 26650,
  },
  {
    id: "shmi1",
    poolId: "shmi",
    label: "Shmi 1",
    smallUrl: "/leader-profile-portraits/shmi/shmi1.v1.96.webp",
    largeUrl: "/leader-profile-portraits/shmi/shmi1.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4150,
    largeBytes: 28284,
  },
  {
    id: "shmi2",
    poolId: "shmi",
    label: "Shmi 2",
    smallUrl: "/leader-profile-portraits/shmi/shmi2.v1.96.webp",
    largeUrl: "/leader-profile-portraits/shmi/shmi2.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4086,
    largeBytes: 28230,
  },
  {
    id: "shmi3",
    poolId: "shmi",
    label: "Shmi 3",
    smallUrl: "/leader-profile-portraits/shmi/shmi3.v1.96.webp",
    largeUrl: "/leader-profile-portraits/shmi/shmi3.v1.320.webp",
    smallSize: 96,
    largeSize: 320,
    smallBytes: 4190,
    largeBytes: 28908,
  },
];

export const FALLBACK_LEADER_PROFILE_PORTRAIT: LeaderProfilePortrait = {
  id: "leader-fallback",
  poolId: "fallback",
  label: "Default leader",
  smallUrl: "/leader-profile-portraits/fallback/leader-fallback.v1.96.webp",
  largeUrl: "/leader-profile-portraits/fallback/leader-fallback.v1.320.webp",
  smallSize: 96,
  largeSize: 320,
  smallBytes: 1968,
  largeBytes: 7224,
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
  return LEADER_PROFILE_PORTRAITS.find((portrait) => portrait.id === id) ?? null;
}

export function isLeaderProfilePortraitId(id: string): boolean {
  return LEADER_PROFILE_PORTRAITS.some((portrait) => portrait.id === id);
}

export function getEnabledLeaderProfilePortraits(settings: LeaderProfilePoolSettings): LeaderProfilePortrait[] {
  return LEADER_PROFILE_PORTRAITS.filter((portrait) => settings[portrait.poolId as LeaderProfilePoolId]);
}
