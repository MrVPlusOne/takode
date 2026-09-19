import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import type { AuxiliaryWorktreeLifecycle } from "../auxiliary-worktrees.js";
import { containerManager } from "../container-manager.js";
import * as gitUtils from "../git-utils.js";
import * as treeGroupStore from "../tree-group-store.js";
import { getActorSessionId, getArchiveSource } from "./sessions-helpers.js";
import { broadcastSessionDeletedAndClose } from "./session-lifecycle-broadcast.js";
import { cleanupWorktree } from "./worktree-cleanup.js";

export function registerSessionDeleteRoute(
  api: Hono,
  ctx: RouteContext,
  pendingWorktreeCleanups: Map<string, Promise<void>>,
  auxiliary?: AuxiliaryWorktreeLifecycle,
) {
  const { resolveId, launcher, authenticateCompanionCallerOptional, wsBridge, worktreeTracker, prPoller, imageStore } =
    ctx;
  api.delete("/sessions/:id", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (pendingWorktreeCleanups.has(id) || auxiliary?.isCleaning(id)) {
      return c.json({ error: "Worktree cleanup is still running" }, 409);
    }

    const registrations = await auxiliary?.registry.list(id);
    if (registrations?.some((record) => record.retention === "temporary" && record.cleanupStatus !== "done")) {
      return c.json(
        {
          error:
            "Archive and resolve temporary worktree cleanup before deleting this session; retained registrations survive deletion",
        },
        409,
      );
    }

    // If not already archived, emit session_archived so the leader gets a
    // herd notification through the same proven path as explicit archiving.
    // Must happen BEFORE kill -- after removal the session info is gone.
    const sessionInfo = launcher.getSession(id);
    if (sessionInfo?.herdedBy && !sessionInfo.archived) {
      const actorId = getActorSessionId(authenticateCompanionCallerOptional(c));
      wsBridge.emitTakodeEvent(id, "session_archived", { archive_source: getArchiveSource(actorId) }, actorId);
    }

    await launcher.kill(id);

    // Clean up container if any
    containerManager.removeContainer(id);

    const mapping = worktreeTracker.getBySession(id);
    const worktreeResult = mapping ? await cleanupWorktree(mapping, worktreeTracker, true) : undefined;
    // Clean up any stale archived ref from a previous archive cycle
    if (sessionInfo?.isWorktree && sessionInfo.repoRoot && sessionInfo.actualBranch) {
      await gitUtils.deleteArchivedRefAsync(sessionInfo.repoRoot, sessionInfo.actualBranch);
    }
    prPoller?.unwatch(id);
    launcher.removeSession(id);
    // Broadcast deletion to all browsers BEFORE closing the session sockets.
    // This ensures every browser tab (not just the one that triggered delete)
    // removes the session from the sidebar immediately.
    broadcastSessionDeletedAndClose(wsBridge, id, sessionInfo ?? undefined);
    await imageStore?.removeSession(id);
    // Clean up tree group assignment (fire-and-forget)
    treeGroupStore.removeSession(id).catch((err) => {
      console.warn("[tree-group] cleanup failed for session:", id, err);
    });
    return c.json({ ok: true, worktree: worktreeResult });
  });
}
