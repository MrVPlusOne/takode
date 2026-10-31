/** The sessions panel's view: sessions by Session Space, by recency, or the topics leaders work in. */
export type SidebarViewMode = "spaces" | "recent" | "topics";

export function isSidebarViewMode(value: unknown): value is SidebarViewMode {
  return value === "spaces" || value === "recent" || value === "topics";
}

/** The most topics the sessions panel keeps pinned. */
export const MAX_PINNED_TOPICS = 50;

/**
 * The topics the user pinned to the top of the sessions panel's Topics mode, by topic ID in the
 * order they were pinned: strings only, each once, at most {@link MAX_PINNED_TOPICS}.
 */
export function normalizePinnedTopicIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200);
  return [...new Set(ids)].slice(0, MAX_PINNED_TOPICS);
}
