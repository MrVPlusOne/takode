import { apiGet, err } from "./takode-core.js";

/** Worker-only spawn flags that make no sense for a peer leader. */
const WORKER_ONLY_SPAWN_FLAGS = ["count", "reviewer", "replace-worktree-worker", "fixed-name"] as const;

type SpawnFlags = Record<string, string | boolean>;

export function validateLeaderSpawnFlags(flags: SpawnFlags): void {
  const asLeader = flags.leader === true;
  if (!asLeader) {
    for (const flag of ["session-space", "memory-space"]) {
      if (flags[flag] !== undefined) err(`--${flag} is only supported with --leader.`);
    }
    return;
  }
  for (const flag of WORKER_ONLY_SPAWN_FLAGS) {
    if (flags[flag] !== undefined) err(`--leader cannot be combined with --${flag}.`);
  }
  for (const flag of ["session-space", "memory-space"]) {
    if (flags[flag] !== undefined && (typeof flags[flag] !== "string" || !flags[flag].trim())) {
      err(`--${flag} requires a value.`);
    }
  }
}

/**
 * The session-space fields for a new leader's create request. By default the
 * leader inherits its creator's session space (the server reads it from
 * `createdBy`) and memory space. `--session-space` picks another tree group by
 * name or id, and its memory space follows unless `--memory-space` also names
 * one; `--memory-space` alone picks the session space that uses that memory
 * space. The server rejects combinations that disagree.
 */
export async function resolveLeaderSpawnSessionSpace(
  base: string,
  flags: SpawnFlags,
  creatorMemorySlug: string | undefined,
): Promise<{ treeGroupId?: string; memorySessionSpaceSlug?: string }> {
  const sessionSpace = typeof flags["session-space"] === "string" ? flags["session-space"].trim() : undefined;
  const memorySpace = typeof flags["memory-space"] === "string" ? flags["memory-space"].trim() : undefined;
  if (!sessionSpace) {
    const memorySessionSpaceSlug = memorySpace ?? creatorMemorySlug;
    return memorySessionSpaceSlug ? { memorySessionSpaceSlug } : {};
  }
  const { groups } = (await apiGet(base, "/tree-groups")) as { groups: Array<{ id: string; name: string }> };
  const byId = groups.find((group) => group.id === sessionSpace);
  const byName = groups.filter((group) => group.name.toLowerCase() === sessionSpace.toLowerCase());
  if (!byId && byName.length > 1) {
    err(`Several session spaces are named "${sessionSpace}"; pass its id instead.`);
  }
  const group = byId ?? byName[0];
  if (!group) {
    err(`Unknown session space: ${sessionSpace}. Session spaces: ${groups.map((g) => g.name).join(", ") || "none"}.`);
  }
  return { treeGroupId: group.id, ...(memorySpace ? { memorySessionSpaceSlug: memorySpace } : {}) };
}
