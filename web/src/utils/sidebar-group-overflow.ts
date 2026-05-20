import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

export const DEFAULT_GROUP_VISIBLE_SESSION_LIMIT = 10;
export const GROUP_VISIBLE_SESSION_LIMIT_OPTIONS = [5, 10, 20, 50] as const;
export const SIDEBAR_GROUP_VISIBLE_LIMITS_KEY = "cc-sidebar-group-visible-limits";

const MIN_GROUP_VISIBLE_SESSION_LIMIT = 1;
const MAX_GROUP_VISIBLE_SESSION_LIMIT = 200;

export function normalizeGroupVisibleSessionLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_GROUP_VISIBLE_SESSION_LIMIT;
  return Math.max(MIN_GROUP_VISIBLE_SESSION_LIMIT, Math.min(MAX_GROUP_VISIBLE_SESSION_LIMIT, Math.trunc(numeric)));
}

export function parseSidebarGroupVisibleLimits(raw: string | null): Map<string, number> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const entries: Array<[string, number]> = [];
    for (const [groupId, value] of Object.entries(parsed)) {
      if (!groupId) continue;
      entries.push([groupId, normalizeGroupVisibleSessionLimit(value)]);
    }
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function serializeSidebarGroupVisibleLimits(limits: ReadonlyMap<string, number>): string {
  const payload: Record<string, number> = {};
  for (const [groupId, limit] of limits) {
    if (!groupId) continue;
    const normalized = normalizeGroupVisibleSessionLimit(limit);
    if (normalized !== DEFAULT_GROUP_VISIBLE_SESSION_LIMIT) payload[groupId] = normalized;
  }
  return JSON.stringify(payload);
}

export function readSidebarGroupVisibleLimits(): Map<string, number> {
  return parseSidebarGroupVisibleLimits(scopedGetItem(SIDEBAR_GROUP_VISIBLE_LIMITS_KEY));
}

export function writeSidebarGroupVisibleLimits(limits: ReadonlyMap<string, number>): void {
  scopedSetItem(SIDEBAR_GROUP_VISIBLE_LIMITS_KEY, serializeSidebarGroupVisibleLimits(limits));
}
