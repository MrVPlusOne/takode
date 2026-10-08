import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Mock } from "vitest";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { HostRegistry } from "../remote-host/host-registry.js";
import { createHostRoutes } from "./hosts.js";

// The Hosts API lists this machine next to the registered hosts, edits each
// machine's Claude/Codex settings (sending a connected host its new settings)
// and turns this machine's own node on or off.
describe("host routes", () => {
  let dir: string;
  let registry: HostRegistry;
  let links: HostLinkManager;
  let app: Hono;
  let localNode: { setEnabled: Mock<(enabled: boolean) => Promise<void>> };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "host-routes-"));
    registry = new HostRegistry(join(dir, "hosts.json"));
    links = new HostLinkManager();
    localNode = {
      setEnabled: vi.fn((enabled: boolean) => registry.setLocalNodeEnabled(enabled)),
    };
    app = new Hono().route("/api", createHostRoutes(registry, links, localNode));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const put = (id: string, body: unknown) =>
    app.request(`/api/hosts/${id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("lists this machine and each host with its settings", async () => {
    const { host } = await registry.register("gpu-box");
    expect((await put("local", { claudeBinary: "/opt/claude" })).status).toBe(200);
    const pushed = vi.spyOn(links, "pushSettings");
    const res = await put(host.id, { codexBinary: "/opt/codex" });
    expect(await res.json()).toEqual({ settings: { claudeBinary: "", codexBinary: "/opt/codex" } });
    expect(pushed).toHaveBeenCalledWith(host.id);

    const listed = (await (await app.request("/api/hosts")).json()) as {
      hosts: Array<{ id: string; settings: unknown }>;
      local: unknown;
    };
    expect(listed.local).toMatchObject({
      id: "local",
      settings: { claudeBinary: "/opt/claude", codexBinary: "" },
      node: { enabled: false, online: false, processes: 0 },
    });
    expect(listed.hosts[0]).toMatchObject({ id: host.id, settings: { claudeBinary: "", codexBinary: "/opt/codex" } });
  });

  it("rejects non-string settings and unknown hosts", async () => {
    expect(await (await put("local", { claudeBinary: 123 })).json()).toEqual({
      error: "claudeBinary must be a string",
    });
    expect((await put("local", { codexBinary: true })).status).toBe(400);
    expect((await put("missing", { claudeBinary: "x" })).status).toBe(404);
  });

  // Turning the local node on goes through LocalNode (which then starts it) and
  // is reported back by the list.
  it("turns this machine's node on and reports it", async () => {
    const turnOn = await app.request("/api/hosts/local/node", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(await turnOn.json()).toEqual({ enabled: true });
    expect(localNode.setEnabled).toHaveBeenCalledWith(true);
    const listed = (await (await app.request("/api/hosts")).json()) as {
      local: { node: { enabled: boolean } };
    };
    expect(listed.local.node.enabled).toBe(true);

    const invalid = await app.request("/api/hosts/local/node", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(invalid.status).toBe(400);
  });
});
