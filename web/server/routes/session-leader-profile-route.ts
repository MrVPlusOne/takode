import type { Hono } from "hono";
import { getLeaderProfilePortraitById } from "../leader-profile-assignments.js";
import type { RouteContext } from "./context.js";
import { isLeaderProfilePortraitId } from "../../shared/leader-profile-portraits.js";

export function registerSessionLeaderProfileRoute(api: Hono, ctx: RouteContext): void {
  const { launcher, resolveId } = ctx;

  api.put("/sessions/:id/leader-profile-portrait", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const session = launcher.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (session.isOrchestrator !== true) {
      return c.json({ error: "Leader profile portraits are only supported for leader sessions" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const portraitId = typeof body.portraitId === "string" ? body.portraitId.trim() : "";
    if (!isLeaderProfilePortraitId(portraitId)) {
      return c.json({ error: "Unknown leader profile portrait" }, 400);
    }

    launcher.setLeaderProfilePortraitId(id, portraitId);
    return c.json({
      ok: true,
      sessionId: id,
      leaderProfilePortraitId: portraitId,
      leaderProfilePortrait: getLeaderProfilePortraitById(portraitId),
    });
  });
}
