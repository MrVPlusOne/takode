import { Hono } from "hono";
import * as questStore from "../quest-store.js";
import type { RouteContext } from "./context.js";

/**
 * Read-only recovery access for payloads written by the rejected quest-owned
 * Outcome implementation. The value is intentionally opaque: normal loading,
 * mutation, search, completion, and feed code must not interpret or promote it.
 */
export function createQuestOutcomeRoutes(_ctx: RouteContext) {
  const api = new Hono();

  api.get("/quests/:questId/outcome", async (c) => {
    const quest = await questStore.getQuest(c.req.param("questId"));
    if (!quest) return c.json({ error: "Quest not found" }, 404);
    const present = Object.prototype.hasOwnProperty.call(quest, "outcome");
    return c.json({
      questId: quest.questId,
      legacy: true,
      present,
      outcome: present ? quest.outcome : null,
    });
  });

  return api;
}
