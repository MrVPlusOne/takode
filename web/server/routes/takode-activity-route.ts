import type { Hono } from "hono";
import { collectActivityDocuments, loadSessionSpaces } from "../activity-documents.js";
import { buildActivityStream } from "../activity-stream.js";
import type { RouteContext } from "./context.js";

/** Default shortened length of each message; `full=1` returns whole messages. */
const ACTIVITY_TEXT_LIMIT = 1000;

/**
 * `GET /takode/activity?since=<ms>&until=<ms>&space=<names|ids|all>&full=1`
 *
 * The user's hand-typed messages and the final messages they were shown in a time window.
 * Without `space`, a session caller sees only its own session space, so a session in
 * one space never pulls another space's content in by accident.
 */
export function registerTakodeActivityRoute(api: Hono, ctx: RouteContext): void {
  api.get("/takode/activity", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;

    const rawUntil = c.req.query("until");
    const rawSince = c.req.query("since");
    const until = rawUntil ? Number(rawUntil) : Date.now();
    const since = rawSince ? Number(rawSince) : until - 24 * 60 * 60 * 1000;
    if (!Number.isFinite(since) || !Number.isFinite(until)) {
      return c.json({ error: "since and until must be epoch milliseconds" }, 400);
    }
    if (since >= until) return c.json({ error: "since must be before until" }, 400);

    const { names: known, nameOf, spaceOf } = await loadSessionSpaces(ctx);
    const requested = c.req.query("space")?.trim();
    let spaces: string[] | null = auth ? [spaceOf(auth.callerId)] : null;
    if (requested === "all") spaces = null;
    else if (requested) {
      spaces = [];
      for (const value of requested.split(",").map((part) => part.trim())) {
        const name = known.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? nameOf(value);
        if (!name)
          return c.json(
            {
              error: `Unknown session space "${value}". Known: ${known.join(", ")}`,
            },
            400,
          );
        spaces.push(name);
      }
    }

    const { documents, unreadable } = await collectActivityDocuments(ctx, {
      spaceOf,
      spaces,
      since,
      loadArchived: true,
    });

    const threads = buildActivityStream({
      documents,
      since,
      until,
      ...(c.req.query("full") === "1" ? {} : { textLimit: ACTIVITY_TEXT_LIMIT }),
    });
    return c.json({ since, until, spaces, threads, ...(unreadable.length ? { unreadable } : {}) });
  });
}
