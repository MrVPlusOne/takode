import { Hono } from "hono";
import type { UserContentService } from "../user-content-service.js";

/** What Settings sends to the session the user picks to set this up; the skill holds the procedure. */
export const USER_CONTENT_SETUP_PROMPT =
  "Please set up Takode-managed instructions and skills for me, or check and repair them if they are already set up. " +
  "Load the `takode-user-content` skill and follow it. Explain what you find before changing anything, and ask me " +
  "before replacing or removing anything that is not identical to the store.";

/**
 * User instructions and skills kept on the coordinator (see `user-content.ts`).
 * An agent sets them up with the `takode user-content` commands, which call
 * these routes; import, take-over and remove-skills change a machine's files,
 * so the agent runs them only on the user's approval. Settings only picks the
 * session that does it. `hostId` is a registered host's id, or null for this
 * machine.
 */
export function createUserContentRoutes(
  service: UserContentService,
  sendToSession: (sessionId: string, text: string) => "sent" | "queued" | "paused_queued" | "dropped" | "no_session",
) {
  const api = new Hono();

  /** The Settings entry point: hand the setup to a session the user picked. */
  api.post("/user-content/agent-setup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId) return c.json({ error: "sessionId required" }, 400);
    const delivery = sendToSession(body.sessionId, USER_CONTENT_SETUP_PROMPT);
    if (delivery === "no_session" || delivery === "dropped") {
      return c.json({ error: "That session cannot receive messages right now" }, 409);
    }
    return c.json({ ok: true, delivery });
  });

  api.post("/user-content/remove-skills", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hostId?: unknown; skills?: unknown; dangling?: unknown };
    const hostId = typeof body.hostId === "string" && body.hostId ? body.hostId : null;
    const skills = Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === "string") : [];
    try {
      return c.json(await service.retireSkills(hostId, skills, body.dangling === true));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

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
