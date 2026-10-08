import { Hono } from "hono";
import type { HostLinkManager } from "../remote-host/host-link-manager.js";
import type { HostRegistry, RegisteredHost } from "../remote-host/host-registry.js";

/**
 * Remote host management. Registering a host returns its token once; the
 * `takode node` helper on that machine presents it when it connects.
 */
export function createHostRoutes(registry: HostRegistry, links: HostLinkManager) {
  const api = new Hono();

  api.get("/hosts", async (c) => {
    const hosts = await registry.list();
    // `build` is this server's commit, which each host's `build` is compared with.
    return c.json({ hosts: hosts.map((host) => ({ ...host, ...links.status(host.id) })), build: links.build });
  });

  api.post("/hosts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
    try {
      const { host, token } = await registry.register(body.name);
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
