/** The sessions panel's view: sessions by Session Space, by recency, or the topics leaders work in. */
export type SidebarViewMode = "spaces" | "recent" | "topics";

export function isSidebarViewMode(value: unknown): value is SidebarViewMode {
  return value === "spaces" || value === "recent" || value === "topics";
}
