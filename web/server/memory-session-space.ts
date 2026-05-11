export const COMPANION_MEMORY_SPACE_SLUG_ENV = "COMPANION_MEMORY_SPACE_SLUG";
export const DEFAULT_MEMORY_SESSION_SPACE_SLUG = "Takode";

export function normalizeMemorySessionSpaceSlug(slug: string | null | undefined): string {
  const normalized = slug?.trim() ?? "";
  return normalized || DEFAULT_MEMORY_SESSION_SPACE_SLUG;
}
