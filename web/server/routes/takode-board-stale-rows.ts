import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import { isBoardLeaderStopped, removeStaleBoardRow } from "../bridge/board-stale-rows.js";

export interface StaleBoardRowRoutesDeps {
  launcher: RouteContext["launcher"];
  wsBridge: RouteContext["wsBridge"];
  authenticateTakodeCaller: RouteContext["authenticateTakodeCaller"];
  resolveId: RouteContext["resolveId"];
  workBoardStateDeps: any;
  isWorkEvidenceMutationLocked: (leaderSessionId: string, questId: string) => boolean;
}

/**
 * A leader removes a row left behind on another leader's board. Boards are
 * otherwise changed only by their own leader, so this is allowed only while
 * that leader is paused or archived (it cannot clean up itself), and it never
 * unpauses it or releases its held input. The reason is kept on the row in
 * that leader's board history.
 */
export function registerStaleBoardRowRoutes(api: Hono, deps: StaleBoardRowRoutesDeps): void {
  const { launcher, wsBridge } = deps;

  api.post("/sessions/:id/board/:questId/remove-stale", async (c) => {
    const auth = deps.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (auth.caller.isOrchestrator !== true) {
      return c.json({ error: "Only a leader can remove another leader's stale board row." }, 403);
    }
    const leaderId = deps.resolveId(c.req.param("id"));
    const leaderInfo = leaderId ? launcher.getSession(leaderId) : undefined;
    const leaderSession = leaderId ? wsBridge.getSession(leaderId) : undefined;
    if (!leaderId || !leaderInfo || !leaderSession?.board) return c.json({ error: "Leader session not found" }, 404);
    if (leaderId === auth.callerId) return c.json({ error: "Use takode board rm for your own board." }, 400);
    const leaderLabel = leaderInfo.sessionNum !== undefined ? `#${leaderInfo.sessionNum}` : leaderId;
    if (!isBoardLeaderStopped(leaderInfo, leaderSession)) {
      return c.json(
        {
          error: `${leaderLabel} is running, so only it can change its board. Stale rows can be removed only from paused or archived leaders.`,
        },
        409,
      );
    }
    const questId = c.req.param("questId").trim();
    if (!/^q-\d+$/i.test(questId)) return c.json({ error: "Invalid quest ID -- must match q-NNN format" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ error: "A --reason is required; it is recorded in the board history." }, 400);
    const row = [...leaderSession.board.values()].find(
      (candidate: { questId: string }) => candidate.questId.toLowerCase() === questId.toLowerCase(),
    );
    if (!row) return c.json({ error: `${leaderLabel}'s board has no active row for ${questId}.` }, 404);
    if (row.landing && !row.landing.deliveryId) {
      return c.json(
        {
          error: `${questId} on ${leaderLabel}'s board waits for a submitted landing change; removing it would lose it.`,
        },
        409,
      );
    }
    if (deps.isWorkEvidenceMutationLocked(leaderId, row.questId)) {
      return c.json({ error: "Cannot remove a board row while a Work evidence mutation is in progress." }, 409);
    }

    const removed = removeStaleBoardRow(
      leaderSession,
      row.questId,
      { reason, removedBy: auth.callerId, removedAt: Date.now() },
      deps.workBoardStateDeps,
    );
    if (!removed) return c.json({ error: `${leaderLabel}'s board has no active row for ${questId}.` }, 404);
    return c.json({ leaderSessionId: leaderId, leaderSessionNum: leaderInfo.sessionNum ?? null, removed });
  });
}
