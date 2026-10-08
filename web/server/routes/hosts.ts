import { Hono } from "hono";
import type { HostLinkManager } from "../remote-host/host-link-manager.js";
import { LOCAL_HOST_ID, type HostRegistry, type RegisteredHost } from "../remote-host/host-registry.js";
import type { LocalNode } from "../remote-host/local-node.js";
import { machineNameError, type ThisMachine } from "../machine-identity.js";

/**
 * Remote host management. Registering a host returns its token once; the
 * `takode node` helper on that machine presents it when it connects.
 * `thisMachine` holds this machine's name, which the routes may change.
 */
export function createHostRoutes(
  registry: HostRegistry,
  links: HostLinkManager,
  localNode: Pick<LocalNode, "setEnabled">,
  thisMachine: Pick<ThisMachine, "name" | "rename">,
) {
  const api = new Hono();

  api.get("/hosts", async (c) => {
    const hosts = await registry.list();
    // `build` is this server's commit, which each host's `build` is compared with.
    // `local` is this machine, which runs sessions without a host, under its
    // own node when `node.enabled` (so they outlive server restarts).
    return c.json({
      hosts: hosts.map((host) => ({
        ...host,
        ...links.status(host.id),
        settings: registry.machineSettings(host.id),
      })),
      build: links.build,
      local: {
        id: LOCAL_HOST_ID,
        name: thisMachine.name,
        settings: registry.machineSettings(LOCAL_HOST_ID),
        node: { enabled: registry.localNodeEnabled(), ...links.status(LOCAL_HOST_ID) },
      },
    });
  });

  /** Turn running this machine's sessions under its own node on or off. */
  api.put("/hosts/local/node", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      enabled?: unknown;
    };
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be a boolean" }, 400);
    await localNode.setEnabled(body.enabled);
    return c.json({ enabled: registry.localNodeEnabled() });
  });

  /** Change a machine's settings (`local` for this machine); a connected host receives them at once. */
  api.put("/hosts/:id/settings", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const field of ["claudeBinary", "codexBinary"]) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return c.json({ error: `${field} must be a string` }, 400);
      }
    }
    const settings = await registry.updateMachineSettings(id, {
      ...(typeof body.claudeBinary === "string" ? { claudeBinary: body.claudeBinary } : {}),
      ...(typeof body.codexBinary === "string" ? { codexBinary: body.codexBinary } : {}),
    });
    if (!settings) return c.json({ error: "Host not found" }, 404);
    links.pushSettings(id);
    return c.json({ settings });
  });

  /**
   * Rename a machine (`local` for this one). The name is kept by the machine
   * itself, so a host must be online to receive it.
   */
  api.put("/hosts/:id/name", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
    const name = body.name.trim();
    try {
      if (id === LOCAL_HOST_ID) {
        const problem =
          machineNameError(name) ??
          ((await registry.list()).some((host) => host.name === name)
            ? `A machine named ${name} already exists`
            : null);
        if (problem) return c.json({ error: problem }, 400);
        await thisMachine.rename(name);
        return c.json({ name });
      }
      if (!(await registry.get(id))) return c.json({ error: "Host not found" }, 404);
      if (!links.status(id).online) return c.json({ error: "Connect the host before renaming it" }, 409);
      await registry.rename(id, name, [thisMachine.name]);
      links.pushMachineName(id, name);
      return c.json({ name });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  api.post("/hosts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
    try {
      const { host, token } = await registry.register(body.name, [thisMachine.name]);
      return c.json({ host, token }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  api.delete("/hosts/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await registry.remove(id))) return c.json({ error: "Host not found" }, 404);
    links.disconnect(id, "Host registration removed");
    return c.json({ ok: true });
  });

  return api;
}

/** The registered host a host-link upgrade request authenticates as, or null. */
export async function authenticateHostRequest(
  request: Request,
  registry: HostRegistry,
): Promise<RegisteredHost | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? registry.authenticate(match[1]!) : null;
}
