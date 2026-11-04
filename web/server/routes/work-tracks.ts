import { Hono } from "hono";
import { basename, isAbsolute, resolve } from "node:path";
import { onMachine } from "../remote-host/host-operations.js";
import { LOCAL_HOST_ID } from "../remote-host/host-registry.js";
import { hostIsOnline } from "../remote-host/session-machine.js";
import { getServerId } from "../settings-manager.js";
import { WorkTrackStore } from "../work-track-store.js";
import { TRACK_NAME_PATTERN, type WorkTrack, type WorkTrackStatus } from "../work-tracks.js";
import type { RouteContext } from "./context.js";

/** A worker whose port target is the track, with the quest it holds. */
interface TrackWorker {
  sessionNum: number | null;
  questId?: string;
}

/**
 * Routes for `takode track`: leaders declare tracks (a repository's integration
 * branch and the branch it follows), any leader may spawn workers onto one, and
 * only the declaring leader closes it. Anyone may read them.
 */
export function createWorkTrackRoutes(ctx: RouteContext, store = new WorkTrackStore(getServerId())) {
  const api = new Hono();

  const machineName = async (hostId: string | undefined) =>
    (hostId
      ? (await ctx.launcher.remoteHosts?.registry.get(hostId))?.name
      : (await ctx.options?.hostExec?.findMachine(LOCAL_HOST_ID))?.name) ??
    hostId ??
    "this machine";

  const workersOn = (track: WorkTrack): TrackWorker[] =>
    ctx.launcher
      .listSessions()
      .filter(
        (session) => !session.archived && session.worktreePortTarget?.track?.toLowerCase() === track.name.toLowerCase(),
      )
      .map((session) => {
        const questId = ctx.wsBridge.getSession(session.sessionId)?.state.claimedQuestId;
        return { sessionNum: session.sessionNum ?? null, ...(questId ? { questId } : {}) };
      });

  const statusOf = async (track: WorkTrack): Promise<WorkTrackStatus | { unavailable: string }> => {
    if (track.hostId && !hostIsOnline(track.hostId))
      return { unavailable: `${await machineName(track.hostId)} is offline` };
    try {
      return await onMachine(track.hostId, "readTrackStatus", track);
    } catch (error) {
      return { unavailable: error instanceof Error ? error.message : String(error) };
    }
  };

  /** What `track list` shows by default; `detail` adds the paths and dates. */
  const summarize = async (track: WorkTrack, options: { status: boolean; detail?: boolean }) => ({
    name: track.name,
    repo: basename(track.repoRoot),
    branch: track.branch,
    follows: track.follows,
    owner: ctx.launcher.getSessionNum(track.ownerSessionId) ?? null,
    machine: await machineName(track.hostId),
    workers: workersOn(track),
    ...(options.status ? { status: await statusOf(track) } : {}),
    ...(track.closedAt ? { closedAt: track.closedAt } : {}),
    ...(options.detail
      ? {
          repoRoot: track.repoRoot,
          checkoutPath: track.checkoutPath,
          createdCheckout: track.createdCheckout,
          createdAt: track.createdAt,
          ...(track.hostId ? { hostId: track.hostId } : {}),
        }
      : {}),
  });

  api.get("/takode/tracks", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const repoRoot = c.req.query("repoRoot");
    const tracks = (await store.list({ closed: c.req.query("closed") === "1" })).filter(
      (track) => !repoRoot || track.repoRoot === repoRoot,
    );
    // Status reads each track's remote, so a caller that only needs names may skip it.
    const status = c.req.query("status") !== "0";
    return c.json({
      tracks: await Promise.all(tracks.map((track) => summarize(track, { status: status && !track.closedAt }))),
    });
  });

  api.get("/takode/tracks/:name", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const track = await store.get(c.req.param("name"));
    if (!track) return c.json({ error: `No open track named ${c.req.param("name")}` }, 404);
    return c.json({ track: await summarize(track, { status: c.req.query("status") !== "0", detail: true }) });
  });

  api.post("/takode/tracks", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!TRACK_NAME_PATTERN.test(name)) {
      return c.json({ error: "A track name is 1-40 letters, digits, dots, dashes or underscores" }, 400);
    }
    if (!repo || !branch) return c.json({ error: "repo and branch are required" }, 400);
    if (body.follows !== undefined && (typeof body.follows !== "string" || !body.follows.trim())) {
      return c.json({ error: "follows must be a branch name" }, 400);
    }
    // The repository is on the declaring leader's machine.
    const hostId = auth.caller.hostId || undefined;
    if (hostId && !isAbsolute(repo)) return c.json({ error: "Give the repository's absolute path" }, 400);
    if (hostId && !hostIsOnline(hostId)) return c.json({ error: `${await machineName(hostId)} is offline` }, 409);
    if (await store.get(name)) return c.json({ error: `A track named ${name} is already open` }, 409);
    try {
      const info = await onMachine(hostId, "repoInfo", hostId ? repo : resolve(repo));
      if (!info) return c.json({ error: `${repo} is not a Git repository` }, 400);
      const sameBranch = (await store.list()).find(
        (track) => track.repoRoot === info.repoRoot && track.branch === branch && track.hostId === hostId,
      );
      if (sameBranch) return c.json({ error: `${branch} is already the branch of track ${sameBranch.name}` }, 409);
      const follows = typeof body.follows === "string" ? body.follows.trim() : info.defaultBranch;
      if (follows === branch) return c.json({ error: "A track cannot follow its own branch" }, 400);
      const checkout = await onMachine(hostId, "prepareTrackCheckout", {
        repoRoot: info.repoRoot,
        name,
        branch,
        follows,
        create: body.create === true,
      });
      const track: WorkTrack = {
        name,
        repoRoot: info.repoRoot,
        branch,
        follows,
        ...checkout,
        ...(hostId ? { hostId } : {}),
        ownerSessionId: auth.callerId,
        createdAt: Date.now(),
      };
      await store.add(track);
      return c.json({ track: await summarize(track, { status: true, detail: true }) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  // Before a worker starts on the track: bring its checkout up to what has landed.
  api.post("/takode/tracks/:name/pull", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const track = await store.get(c.req.param("name"));
    if (!track) return c.json({ error: `No open track named ${c.req.param("name")}` }, 404);
    if (track.hostId && !hostIsOnline(track.hostId)) {
      return c.json({ error: `${await machineName(track.hostId)} is offline` }, 409);
    }
    return c.json(await onMachine(track.hostId, "pullTrackCheckout", track));
  });

  api.post("/takode/tracks/:name/close", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const track = await store.get(c.req.param("name"));
    if (!track) return c.json({ error: `No open track named ${c.req.param("name")}` }, 404);
    if (track.ownerSessionId !== auth.callerId) {
      const owner = ctx.launcher.getSessionNum(track.ownerSessionId);
      return c.json(
        { error: `Only the leader that declared it (#${owner ?? "?"}) may close track ${track.name}` },
        403,
      );
    }
    let keptCheckout: string | undefined;
    if (!track.createdCheckout) keptCheckout = "it was an existing checkout";
    else if (workersOn(track).length > 0) keptCheckout = "workers still use it";
    else {
      try {
        await onMachine(track.hostId, "removeTrackCheckout", track);
      } catch (error) {
        keptCheckout = error instanceof Error ? error.message.split("\n")[0] : String(error);
      }
    }
    await store.close(track.name);
    return c.json({
      track: await summarize({ ...track, closedAt: Date.now() }, { status: false, detail: true }),
      ...(keptCheckout ? { keptCheckout } : {}),
    });
  });

  return api;
}
