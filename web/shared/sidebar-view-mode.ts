/** The sessions panel's view: sessions by Session Space, or by recency. */
export type SidebarViewMode = "spaces" | "recent";

export function isSidebarViewMode(value: unknown): value is SidebarViewMode {
  return value === "spaces" || value === "recent";
}

/**
 * A saved view as the panel shows it now. The retired Topics view (topic rows; topics became tags)
 * reads as Recent, which listed its sessions the same way; anything else is Spaces.
 */
export function normalizeSidebarViewMode(value: unknown): SidebarViewMode {
  return value === "recent" || value === "topics" ? "recent" : "spaces";
}
