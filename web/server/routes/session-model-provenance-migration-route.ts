import type { Hono } from "hono";
import type { RouteContext } from "./context.js";
import { normalizeModelProvenanceMigration } from "../model-provenance-migration.js";
import { projectModelProvenanceMigrationFamilies } from "../model-provenance-migration-runtime.js";

export function registerSessionModelProvenanceMigrationRoute(api: Hono, ctx: RouteContext): void {
  const store = ctx.modelProvenanceMigrationAcknowledgementStore;
  if (!store) return;
  const inFlightAcknowledgements = new Map<
    string,
    Promise<{ ok: true; eventId: string; acknowledgedAt: number; affectedSessionIds: string[] }>
  >();

  api.post("/sessions/:id/model-provenance-migration/acknowledge", async (c) => {
    const sessionId = ctx.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const launcherSession = ctx.launcher.getSession(sessionId);
    const bridgeSession = ctx.wsBridge.getSession(sessionId);
    if (!launcherSession || !bridgeSession) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId) return c.json({ error: "Migration event ID is required" }, 400);

    const currentMigration = bridgeSession.state.modelProvenanceMigration;
    if (!currentMigration) {
      return c.json({ error: "No model provenance migration is active", code: "migration_event_changed" }, 409);
    }
    const normalized = normalizeModelProvenanceMigration(currentMigration);
    bridgeSession.state.modelProvenanceMigration = normalized;
    launcherSession.modelProvenanceMigration = normalized;
    if (normalized.eventId !== eventId) {
      return c.json(
        {
          error: "The model provenance migration changed before acknowledgement",
          code: "migration_event_changed",
          currentEventId: normalized.eventId,
        },
        409,
      );
    }

    let operation = inFlightAcknowledgements.get(eventId);
    if (!operation) {
      operation = (async () => {
        const acknowledgedAt = await store.acknowledge(eventId);
        const affectedSessionIds = projectModelProvenanceMigrationFamilies(ctx.launcher, ctx.wsBridge, store, {
          eventId,
          broadcast: true,
        });
        return { ok: true as const, eventId, acknowledgedAt, affectedSessionIds };
      })();
      inFlightAcknowledgements.set(eventId, operation);
      void operation.then(
        () => {
          if (inFlightAcknowledgements.get(eventId) === operation) inFlightAcknowledgements.delete(eventId);
        },
        () => {
          if (inFlightAcknowledgements.get(eventId) === operation) inFlightAcknowledgements.delete(eventId);
        },
      );
    }
    return c.json(await operation);
  });
}
