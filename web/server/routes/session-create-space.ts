import { normalizeMemorySessionSpaceSlug } from "../memory-session-space.js";
import { memorySessionSpaceSlugForTreeGroup } from "../session-memory-space.js";
import type { TreeGroupState } from "../tree-group-store.js";

export interface SessionSpaceForCreateInput {
  treeState: Pick<TreeGroupState, "groups">;
  /** The server's memory space, which the Default session space uses. */
  fallbackSlug: string;
  /** An existing tree group the request asked for (already validated). */
  requestedTreeGroupId?: string;
  /** A memory space the request asked for. */
  requestedMemorySlug?: string;
  /** The tree group of the session that asked for this one, if any. */
  creatorTreeGroupId?: string;
}

export type SessionSpaceForCreate =
  | {
      ok: true;
      treeGroupId?: string;
      memorySessionSpaceSlug: string;
      /** The request itself chose the tree group, so later leader grouping must not move it. */
      treeGroupFromRequest: boolean;
    }
  | { ok: false; error: string };

/**
 * Pick the session space (tree group) and memory space of a new session so the
 * two always agree: a session space's memory space is its name, and Default's
 * is the server's. Whichever side the request names decides the other, the
 * creator's session space fills in when neither is named, and a request naming
 * both that disagree is rejected rather than creating a split session.
 */
export function resolveSessionSpaceForCreate(input: SessionSpaceForCreateInput): SessionSpaceForCreate {
  const { treeState, fallbackSlug, requestedTreeGroupId, creatorTreeGroupId } = input;
  const slugFor = (groupId: string | undefined) => memorySessionSpaceSlugForTreeGroup(treeState, groupId, fallbackSlug);
  const groupLabel = (groupId: string) =>
    treeState.groups.find((group) => group.id === groupId)?.name ?? (groupId === "default" ? "Default" : groupId);
  const requestedSlug =
    input.requestedMemorySlug === undefined ? undefined : normalizeMemorySessionSpaceSlug(input.requestedMemorySlug);

  if (requestedTreeGroupId) {
    const groupSlug = slugFor(requestedTreeGroupId) ?? normalizeMemorySessionSpaceSlug(fallbackSlug);
    if (requestedSlug !== undefined && requestedSlug !== groupSlug) {
      return {
        ok: false,
        error:
          `Memory space "${requestedSlug}" does not match session space "${groupLabel(requestedTreeGroupId)}" ` +
          `(memory space "${groupSlug}"). Omit memorySessionSpaceSlug or pick the matching session space.`,
      };
    }
    return {
      ok: true,
      treeGroupId: requestedTreeGroupId,
      memorySessionSpaceSlug: groupSlug,
      treeGroupFromRequest: true,
    };
  }

  if (requestedSlug === undefined) {
    return {
      ok: true,
      treeGroupId: creatorTreeGroupId,
      memorySessionSpaceSlug: slugFor(creatorTreeGroupId) ?? normalizeMemorySessionSpaceSlug(fallbackSlug),
      treeGroupFromRequest: false,
    };
  }

  if (creatorTreeGroupId && slugFor(creatorTreeGroupId) === requestedSlug) {
    return {
      ok: true,
      treeGroupId: creatorTreeGroupId,
      memorySessionSpaceSlug: requestedSlug,
      treeGroupFromRequest: false,
    };
  }
  const matches = treeState.groups.filter((group) => group.id !== "default" && slugFor(group.id) === requestedSlug);
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Several session spaces use memory space "${requestedSlug}"; pass treeGroupId to pick one.`,
    };
  }
  if (matches.length === 1) {
    return { ok: true, treeGroupId: matches[0].id, memorySessionSpaceSlug: requestedSlug, treeGroupFromRequest: true };
  }
  if (requestedSlug === normalizeMemorySessionSpaceSlug(fallbackSlug)) {
    return { ok: true, treeGroupId: "default", memorySessionSpaceSlug: requestedSlug, treeGroupFromRequest: true };
  }
  return {
    ok: false,
    error:
      `No session space uses memory space "${requestedSlug}". ` +
      "Create a session space with that name first, or pass treeGroupId without memorySessionSpaceSlug.",
  };
}
