import type { Hono } from "hono";
import { stat } from "node:fs/promises";
import { openLocalPathContainingFolder } from "../local-path-actions.js";
import type { RouteContext } from "./context.js";

type SessionDirectoryOpenTarget = "working-directory" | "worktree" | "base-repo";

interface SessionProjectMeta {
  cwd: string;
  repoRoot?: string;
}

interface SessionProjectBridgeState {
  state?: {
    cwd?: string;
    repo_root?: string;
    is_worktree?: boolean;
  };
}

function parseSessionDirectoryOpenTarget(value: unknown): SessionDirectoryOpenTarget | null {
  if (value === "working-directory" || value === "worktree" || value === "base-repo") {
    return value;
  }
  return null;
}

export function registerSessionDirectoryRoutes(
  api: Hono,
  deps: Pick<RouteContext, "launcher" | "resolveId" | "wsBridge"> & {
    backfillSessionProjectMeta: (
      info: SessionProjectMeta,
      bridgeSession?: SessionProjectBridgeState | null,
    ) => Promise<void>;
  },
) {
  const { launcher, resolveId, wsBridge, backfillSessionProjectMeta } = deps;

  api.post("/sessions/:id/directories/open", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);

    const session = launcher.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);

    const body = (await c.req.json().catch(() => null)) as { target?: unknown } | null;
    const target = parseSessionDirectoryOpenTarget(body?.target);
    if (!target) {
      return c.json({ error: 'target must be "working-directory", "worktree", or "base-repo"' }, 400);
    }

    const bridgeSession = wsBridge.getSession(id) as SessionProjectBridgeState | null;
    const bridgeState = bridgeSession?.state;
    const info = {
      cwd: bridgeState?.cwd || session.cwd || "",
      repoRoot: bridgeState?.repo_root ?? session.repoRoot ?? undefined,
    };
    await backfillSessionProjectMeta(info, bridgeSession);

    const isWorktree = Boolean(bridgeState?.is_worktree ?? session.isWorktree);
    const directoryPath =
      target === "base-repo" ? info.repoRoot : target === "worktree" && !isWorktree ? undefined : info.cwd;

    if (!directoryPath) {
      const label =
        target === "base-repo"
          ? "Base repo directory"
          : target === "worktree"
            ? "Worktree directory"
            : "Working directory";
      return c.json({ error: `${label} is not available for this session` }, 404);
    }

    const infoStat = await stat(directoryPath).catch(() => null);
    if (!infoStat) {
      return c.json({ error: `Directory does not exist: ${directoryPath}` }, 404);
    }
    if (!infoStat.isDirectory()) {
      return c.json({ error: `Path is not a directory: ${directoryPath}` }, 400);
    }

    try {
      return c.json(await openLocalPathContainingFolder({ absolutePath: directoryPath, isDirectory: true }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Cannot open directory" }, 400);
    }
  });
}
