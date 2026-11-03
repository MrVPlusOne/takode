import type { Hono } from "hono";
import { isAbsolute, resolve } from "node:path";
import {
  type AuxiliaryWorktreeLifecycle,
  type AuxiliaryWorktreePathState,
  type AuxiliaryWorktreeTarget,
  canonicalWorktreePath,
} from "../auxiliary-worktrees.js";
import type { AuxiliaryWorktreeRegistration } from "../auxiliary-worktree-registry.js";
import { LOCAL_HOST_ID } from "../remote-host/host-registry.js";
import { hostIsOnline } from "../remote-host/session-machine.js";
import type { RouteContext } from "./context.js";

/** The machine a request names, by its remote host id (absent for this machine) and name; or why it names none. */
type MachineChoice = { hostId?: string; name: string } | { error: string };

function publicRegistration(
  record: AuxiliaryWorktreeRegistration,
  machineName: string,
  pathState: AuxiliaryWorktreePathState | null = null,
) {
  return {
    sessionId: record.sessionId,
    machine: machineName,
    pathState,
    path: record.worktreePath,
    repoRoot: record.repoRoot,
    branch: record.branch,
    baseBranch: record.baseBranch ?? null,
    retention: record.retention,
    cleanupStatus: record.cleanupStatus ?? null,
    cleanupReason: record.cleanupReason ?? null,
  };
}

export function registerAuxiliaryWorktreeRoutes(api: Hono, ctx: RouteContext, lifecycle: AuxiliaryWorktreeLifecycle) {
  const registry = () => ctx.launcher?.remoteHosts?.registry;
  const machineName = async (hostId: string | undefined) =>
    (hostId
      ? (await registry()?.get(hostId))?.name
      : (await ctx.options?.hostExec?.findMachine(LOCAL_HOST_ID))?.name) ??
    hostId ??
    "this machine";
  const withMachine = async (record: AuxiliaryWorktreeRegistration) =>
    publicRegistration(record, await machineName(record.hostId));

  /** The machine a request names (`host`), else `fallback`: the caller's own machine for registration. */
  const chooseMachine = async (host: unknown, fallback: string | undefined): Promise<MachineChoice> => {
    if (host === undefined) return { ...(fallback ? { hostId: fallback } : {}), name: await machineName(fallback) };
    if (typeof host !== "string" || !host.trim()) return { error: "host must be a machine name" };
    const machine = await ctx.options?.hostExec?.findMachine(host.trim());
    if (!machine) return { error: `No machine named ${host}` };
    return machine.id === LOCAL_HOST_ID ? { name: machine.name } : { hostId: machine.id, name: machine.name };
  };

  /** The registration a retry or unregister request names: its path, and its machine when given. */
  const targetFor = async (sessionId: string, body: unknown): Promise<AuxiliaryWorktreeTarget | { error: string }> => {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (typeof input.path !== "string" || !input.path) return { error: "Select one registered path" };
    let target: AuxiliaryWorktreeTarget = { path: input.path };
    if (input.host !== undefined) {
      const machine = await chooseMachine(input.host, undefined);
      if ("error" in machine) return machine;
      target = { path: input.path, hostId: machine.hostId };
    }
    // Registered paths are canonical; a path not registered as given may be a local alias of one.
    const registered = await lifecycle.registry.list(sessionId);
    if (!registered.some((record) => record.worktreePath === target.path)) {
      target = { ...target, path: await canonicalWorktreePath(target.path) };
    }
    return target;
  };

  api.get("/sessions/:id/worktrees", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    // Whether each checkout still exists, checked on its machine; a removed one is not checked again.
    const worktrees = await Promise.all(
      (await lifecycle.registry.list(id)).map(async (record) =>
        publicRegistration(
          record,
          await machineName(record.hostId),
          record.cleanupStatus === "done" ? null : await lifecycle.pathState(record),
        ),
      ),
    );
    return c.json({ worktrees });
  });

  api.post("/sessions/:id/worktrees", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (id !== auth.callerId) return c.json({ error: "Register worktrees only for your own session" }, 403);
    const input = await c.req.json().catch(() => null);
    if (
      !input ||
      typeof input.path !== "string" ||
      !input.path ||
      !["temporary", "retained"].includes(input.retention) ||
      (input.baseBranch !== undefined && (typeof input.baseBranch !== "string" || !input.baseBranch))
    ) {
      return c.json({ error: "path and explicit temporary/retained retention are required" }, 400);
    }
    // The checkout's machine: the one named, else the session's own (its remote host, or this machine).
    const machine = await chooseMachine(input.host, ctx.launcher?.getSession(id)?.hostId);
    if ("error" in machine) return c.json({ error: machine.error }, 400);
    if (machine.hostId && !isAbsolute(input.path)) {
      return c.json({ error: `Give the checkout's absolute path on ${machine.name}` }, 400);
    }
    if (machine.hostId && !hostIsOnline(machine.hostId)) {
      return c.json({ error: `Host ${machine.name} is offline; register the checkout once it is back` }, 409);
    }
    try {
      const path = machine.hostId ? input.path : resolve(input.path);
      const record = await lifecycle.register(id, path, input.retention, input.baseBranch, machine.hostId);
      return c.json({ worktree: publicRegistration(record, machine.name) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  api.post("/sessions/:id/worktrees/cleanup", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const target = await targetFor(id, await c.req.json().catch(() => null));
    if ("error" in target) return c.json({ error: target.error }, 400);
    try {
      const [record] = await lifecycle.cleanup(id, target);
      const ok = record?.cleanupStatus === "done";
      return c.json(
        {
          ok,
          worktree: record && (await withMachine(record)),
          error: ok ? undefined : (record?.cleanupReason ?? "Retained worktrees are not cleanup candidates"),
        },
        ok ? 200 : 409,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  // A session drops its own registration (or its leader does for it); files are never touched.
  api.post("/sessions/:id/worktrees/unregister", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (id !== auth.callerId && ctx.launcher?.getSession(id)?.herdedBy !== auth.callerId) {
      return c.json({ error: "Unregister only your own worktrees, or those of a worker you lead" }, 403);
    }
    const target = await targetFor(id, await c.req.json().catch(() => null));
    if ("error" in target) return c.json({ error: target.error }, 400);
    try {
      const record = await lifecycle.unregister(id, target);
      return c.json({ worktree: await withMachine(record) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
}
