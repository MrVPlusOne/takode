import type { QuestStatus } from "../types.js";
import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

const QUESTMASTER_VIEW_STATE_KEY = "cc-questmaster-view";

const VALID_QUEST_STATUSES: Set<QuestStatus> = new Set(["idea", "refined", "in_progress", "done"]);

export type QuestmasterViewState = {
  scrollTop: number;
  /** The one status shown, or undefined for all quests. */
  statusFilter?: QuestStatus;
};

/**
 * Read a saved status filter. Older saves kept a list from the multi-select
 * filter; a single entry still applies, anything else means all quests.
 */
function normalizeStatusFilter(value: unknown): QuestStatus | undefined {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  return VALID_QUEST_STATUSES.has(candidate as QuestStatus) ? (candidate as QuestStatus) : undefined;
}

export function loadQuestmasterViewState(): QuestmasterViewState | null {
  const raw = scopedGetItem(QUESTMASTER_VIEW_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { scrollTop?: unknown; statusFilter?: unknown };
    const scrollTop =
      typeof parsed.scrollTop === "number" && Number.isFinite(parsed.scrollTop) ? Math.max(0, parsed.scrollTop) : 0;
    const statusFilter = normalizeStatusFilter(parsed.statusFilter);
    return statusFilter ? { scrollTop, statusFilter } : { scrollTop };
  } catch {
    return null;
  }
}

export function saveQuestmasterViewState(state: QuestmasterViewState): void {
  scopedSetItem(
    QUESTMASTER_VIEW_STATE_KEY,
    JSON.stringify({
      scrollTop: Math.max(0, state.scrollTop),
      statusFilter: normalizeStatusFilter(state.statusFilter),
    }),
  );
}
