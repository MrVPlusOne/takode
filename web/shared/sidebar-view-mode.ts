/** The sessions panel's view: sessions by Session Space, by recency, or every leader's threads. */
export type SidebarViewMode = "spaces" | "recent" | "threads";

export function isSidebarViewMode(value: unknown): value is SidebarViewMode {
  return value === "spaces" || value === "recent" || value === "threads";
}

/**
 * A saved view as the panel shows it now. The retired Topics view (topic rows; topics became tags)
 * reads as Threads, which took its place; anything unknown is Spaces.
 */
export function normalizeSidebarViewMode(value: unknown): SidebarViewMode {
  if (value === "topics") return "threads";
  return isSidebarViewMode(value) ? value : "spaces";
}
