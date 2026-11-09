import { Hono, type Context } from "hono";
import { Readable } from "node:stream";
import { HostExecError } from "../remote-host/host-exec.js";
import type { RouteContext } from "./context.js";

/**
 * Longest a caller may wait in one request for its command to end. The
 * server's HTTP idle timeout must stay longer (see `HTTP_IDLE_TIMEOUT_SECONDS`).
 */
export const MAX_WAIT_SECONDS = 30;

const BACKGROUND_REMOVED =
  "takode exec --background was removed: takode exec now runs until the command ends. " +
  "Run a long command with your own background mechanism (Claude: Bash run_in_background; Codex: a background terminal).";

/**
 * Routes for `takode exec`: sessions run commands on registered hosts and the
 * coordinator's own machine, then follow, read and stop them. Any session may
 * read any command's record and output; only the session that ran a command,
 * or a leader, may stop it.
 */
export function createHostExecRoutes(ctx: RouteContext) {
  const api = new Hono();

  const guard = (c: Context) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return { response: auth.response };
    const exec = ctx.options?.hostExec;
    if (!exec) return { response: c.json({ error: "takode exec is not available on this server" }, 503) };
    return { auth, exec };
  };

  api.post("/takode/exec", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.pool !== undefined && typeof body.pool !== "string")
      return c.json({ error: "pool must be a string" }, 400);
    const pool = typeof body.pool === "string" && body.pool.trim() ? body.pool : null;
    // With a pool, the machine may be left to the pool: any machine it has slots on.
    if (body.host !== undefined && typeof body.host !== "string")
      return c.json({ error: "host must be a string" }, 400);
    if (!pool && !(typeof body.host === "string" && body.host.trim()))
      return c.json({ error: "host is required" }, 400);
    if (typeof body.command !== "string") return c.json({ error: "command is required" }, 400);
    if (body.cwd !== undefined && typeof body.cwd !== "string") return c.json({ error: "cwd must be a string" }, 400);
    // A takode CLI from before its removal would leave the command without a caller, which stops it.
    if (body.background === true) return c.json({ error: BACKGROUND_REMOVED }, 400);
    const memoryLimitBytes = body.memoryLimitBytes;
    if (
      memoryLimitBytes !== undefined &&
      (typeof memoryLimitBytes !== "number" || !Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes <= 0)
    ) {
      return c.json({ error: "memoryLimitBytes must be a positive whole number" }, 400);
    }
    try {
      const job = await g.exec.start({
        sessionId: g.auth.callerId,
        sessionNum: ctx.launcher.getSessionNum(g.auth.callerId) ?? null,
        questId: ctx.wsBridge.getSession(g.auth.callerId)?.state.claimedQuestId ?? null,
        host: typeof body.host === "string" ? body.host : "",
        command: body.command,
        pool,
        cwd: typeof body.cwd === "string" ? body.cwd : null,
        ...(memoryLimitBytes !== undefined ? { memoryLimitBytes } : {}),
      });
      return c.json({ job }, 201);
    } catch (error) {
      if (error instanceof HostExecError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  api.get("/takode/exec/jobs", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const limit = Number(c.req.query("limit") ?? 20);
    const jobs = g.exec.list({
      ...(c.req.query("all") === "1" ? {} : { sessionId: g.auth.callerId }),
      limit: Number.isSafeInteger(limit) && limit > 0 ? limit : 20,
    });
    return c.json({ jobs });
  });

  /** A command's record; with `wait`, after it ends or that many seconds pass. */
  api.get("/takode/exec/jobs/:id", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const wait = Math.min(Math.max(Number(c.req.query("wait") ?? 0) || 0, 0), MAX_WAIT_SECONDS);
    const job = await g.exec.wait(c.req.param("id"), wait * 1000);
    return job ? c.json({ job }) : notFound(c);
  });

  api.get("/takode/exec/jobs/:id/output", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const tail = c.req.query("tail");
    const tailLines = tail === undefined ? undefined : Number(tail);
    if (tailLines !== undefined && !(Number.isSafeInteger(tailLines) && tailLines > 0)) {
      return c.json({ error: "tail must be a positive number of lines" }, 400);
    }
    const output = await g.exec.readOutput(c.req.param("id"), tailLines === undefined ? {} : { tailLines });
    return output ? c.json(output) : notFound(c);
  });

  /** A command's whole output as plain text, or a 1-based inclusive range of its lines or bytes (`lines=A-B`, `bytes=A-B`). */
  api.get("/takode/exec/jobs/:id/log", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const lines = parseRange(c.req.query("lines"));
    const bytes = parseRange(c.req.query("bytes"));
    if (lines === "invalid" || bytes === "invalid") {
      return c.json({ error: "lines and bytes take a range such as 200-400 (1-based, inclusive)" }, 400);
    }
    const log = await g.exec.readLog(c.req.param("id"), {
      ...(lines ? { lines } : {}),
      ...(bytes ? { bytes } : {}),
    });
    if (!log) return notFound(c);
    return new Response(Readable.toWeb(log) as unknown as ReadableStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });

  api.post("/takode/exec/jobs/:id/kill", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const job = g.exec.get(c.req.param("id"));
    if (!job) return notFound(c);
    if (job.sessionId !== g.auth.callerId && !g.auth.caller.isOrchestrator) {
      return c.json({ error: "Only the session that ran it, or a leader, can stop it" }, 403);
    }
    return c.json({ job: g.exec.kill(job.id) });
  });

  return api;
}

function notFound(c: Context) {
  return c.json({ error: `No command ${c.req.param("id")}; list them with takode exec list` }, 404);
}

/** `A-B` (or `A` for one) as 1-based inclusive bounds; undefined when absent. */
function parseRange(value: string | undefined): [number, number] | "invalid" | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) return "invalid";
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return from >= 1 && to >= from ? [from, to] : "invalid";
}
