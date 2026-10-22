import type { Hono } from "hono";
import { getSettings, updateSettings } from "../settings-manager.js";
import { chooseDistinctLeaderProfilePortraitIds } from "../leader-profile-assignments.js";
import type { RouteContext } from "./context.js";
import {
  getEnabledLeaderProfilePortraits,
  normalizeLeaderProfilePoolSettings,
} from "../../shared/leader-profile-portraits.js";

const ANIMALS_ONLY = { tako: false, shmi: false, animals: true } as const;

/**
 * Whether to offer the switch to the Animals portraits: once, to installs still drawing leaders
 * from the cat sets with Animals off. New installs default to Animals and never qualify.
 */
export function shouldOfferAnimalPortraits(): boolean {
  const settings = getSettings();
  if (settings.leaderProfileAnimalsOfferDone) return false;
  const pools = normalizeLeaderProfilePoolSettings(settings.leaderProfilePools);
  return !pools.animals && (pools.tako || pools.shmi);
}

/**
 * The one-time Animals portraits offer: whether to show it, and the user's answer. Accepting
 * switches the portrait sets to Animals only; with `currentLeaders` it also gives every active
 * leader a new animal portrait, replacing any it had, including ones picked by hand.
 */
export function registerLeaderProfileAnimalsOfferRoutes(api: Hono, ctx: Pick<RouteContext, "launcher">): void {
  api.get("/leader-profile/animals-offer", (c) => c.json({ show: shouldOfferAnimalPortraits() }));

  api.post("/leader-profile/animals-offer/dismiss", (c) => {
    updateSettings({ leaderProfileAnimalsOfferDone: true });
    return c.json({ ok: true });
  });

  api.post("/leader-profile/animals-offer/accept", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { currentLeaders?: unknown };
    const settings = updateSettings({ leaderProfilePools: { ...ANIMALS_ONLY }, leaderProfileAnimalsOfferDone: true });
    let reassignedLeaders = 0;
    if (body.currentLeaders === true) {
      const leaderIds = ctx.launcher
        .listSessions()
        .filter((session) => session.isOrchestrator === true && session.archived !== true)
        .map((session) => session.sessionId);
      const portraits = getEnabledLeaderProfilePortraits(settings.leaderProfilePools ?? ANIMALS_ONLY);
      for (const [sessionId, portraitId] of chooseDistinctLeaderProfilePortraitIds(leaderIds, portraits)) {
        ctx.launcher.setLeaderProfilePortraitId(sessionId, portraitId);
        reassignedLeaders++;
      }
    }
    return c.json({ ok: true, leaderProfilePools: settings.leaderProfilePools, reassignedLeaders });
  });
}
