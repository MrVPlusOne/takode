import { Hono } from "hono";
import type { UserContentService } from "../user-content-service.js";

/**
 * User instructions and skills kept on the coordinator (see `user-content.ts`).
 * Import and take-over replace files on a machine, so they run only when the
 * user approves them (Settings, or an agent acting on the user's approval).
 * `hostId` is a registered host's id, or null for this machine.
 */
export function createUserContentRoutes(service: UserContentService) {
  const api = new Hono();

  api.get("/user-content", async (c) => c.json(await service.status()));

  /** The one-time notice after an upgrade, until the store has content or the user dismisses it. */
  api.get("/user-content/notice", async (c) => c.json(await service.notice()));

  api.post("/user-content/notice/dismiss", async (c) => {
    await service.dismissNotice();
    return c.json({ ok: true });
  });

  api.post("/user-content/import", async (c) => {
    const hostId = await readHostId(c.req.json());
    try {
      return c.json(await service.importFrom(hostId));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  api.post("/user-content/take-over", async (c) => {
    const hostId = await readHostId(c.req.json());
    const result = await service.takeOver(hostId);
    if (!result) return c.json({ error: "Takode could not update that machine; see the machine's status" }, 502);
    return c.json({ result });
  });

  return api;
}

async function readHostId(body: Promise<unknown>): Promise<string | null> {
  const parsed = (await body.catch(() => ({}))) as { hostId?: unknown };
  return typeof parsed?.hostId === "string" && parsed.hostId ? parsed.hostId : null;
}
