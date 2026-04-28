import type { QuestStatus } from "../types.js";
import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

const QUESTMASTER_VIEW_STATE_KEY = "cc-questmaster-view";
export const VERIFICATION_INBOX_COLLAPSE_KEY = "verification_inbox";

export type QuestmasterCollapsedGroup = QuestStatus | typeof VERIFICATION_INBOX_COLLAPSE_KEY;

const QUESTMASTER_COLLAPSE_GROUPS: Set<QuestmasterCollapsedGroup> = new Set([
  "idea",
  "refined",
  "in_progress",
  "done",
  VERIFICATION_INBOX_COLLAPSE_KEY,
]);

const VALID_QUEST_STATUSES: Set<QuestStatus> = new Set(["idea", "refined", "in_progress", "done"]);

export type QuestmasterViewState = {
  scrollTop: number;
  collapsedGroups: QuestmasterCollapsedGroup[];
  statusFilter?: QuestStatus[];
};

function normalizeCollapsedGroups(value: unknown): QuestmasterCollapsedGroup[] {
  if (!Array.isArray(value)) return [];
  return value.filter((status): status is QuestmasterCollapsedGroup =>
    QUESTMASTER_COLLAPSE_GROUPS.has(status as QuestmasterCollapsedGroup),
  );
}

/** Normalize a persisted status filter array. Returns undefined if absent or invalid (meaning "all"). */
function normalizeStatusFilter(value: unknown): QuestStatus[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid = value.filter((s): s is QuestStatus => VALID_QUEST_STATUSES.has(s as QuestStatus));
  // If empty or contains all statuses, treat as "all" (no filter stored)
  if (valid.length === 0 || valid.length === VALID_QUEST_STATUSES.size) return undefined;
  return valid;
}

export function loadQuestmasterViewState(): QuestmasterViewState | null {
  const raw = scopedGetItem(QUESTMASTER_VIEW_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { scrollTop?: unknown; collapsedGroups?: unknown; statusFilter?: unknown };
    const scrollTop =
      typeof parsed.scrollTop === "number" && Number.isFinite(parsed.scrollTop) ? Math.max(0, parsed.scrollTop) : 0;
    return {
      scrollTop,
      collapsedGroups: normalizeCollapsedGroups(parsed.collapsedGroups),
      statusFilter: normalizeStatusFilter(parsed.statusFilter),
    };
  } catch {
    return null;
  }
}

export function saveQuestmasterViewState(state: QuestmasterViewState): void {
  scopedSetItem(
    QUESTMASTER_VIEW_STATE_KEY,
    JSON.stringify({
      scrollTop: Math.max(0, state.scrollTop),
      collapsedGroups: normalizeCollapsedGroups(state.collapsedGroups),
      statusFilter: normalizeStatusFilter(state.statusFilter),
    }),
  );
}

/**
 * Toggle a status in a multi-select filter set.
 * - When all are selected, clicking one selects ONLY that one.
 * - When a subset is active, toggles the status on/off.
 * - Deselecting the last status reverts to all.
 */
export function toggleStatusFilter(current: Set<QuestStatus>, status: QuestStatus): Set<QuestStatus> {
  if (current.size === VALID_QUEST_STATUSES.size) return new Set([status]);
  const next = new Set(current);
  if (next.has(status)) {
    next.delete(status);
    if (next.size === 0) return new Set(VALID_QUEST_STATUSES);
  } else {
    next.add(status);
  }
  return next;
}
