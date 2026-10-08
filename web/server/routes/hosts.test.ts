import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { HostRegistry } from "../remote-host/host-registry.js";
import { createHostRoutes } from "./hosts.js";

// The Hosts API lists this machine next to the registered hosts and edits each
// machine's Claude/Codex settings, sending a remote host its new settings.
describe("host routes", () => {
  let dir: string;
  let registry: HostRegistry;
  let links: HostLinkManager;
  let app: Hono;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "host-routes-"));
    registry = new HostRegistry(join(dir, "hosts.json"));
    links = new HostLinkManager();
    app = new Hono().route("/api", createHostRoutes(registry, links));
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
    expect(listed.local).toEqual({ id: "local", settings: { claudeBinary: "/opt/claude", codexBinary: "" } });
    expect(listed.hosts[0]).toMatchObject({ id: host.id, settings: { claudeBinary: "", codexBinary: "/opt/codex" } });
  });

  it("rejects non-string settings and unknown hosts", async () => {
    expect(await (await put("local", { claudeBinary: 123 })).json()).toEqual({
      error: "claudeBinary must be a string",
    });
    expect((await put("local", { codexBinary: true })).status).toBe(400);
    expect((await put("missing", { claudeBinary: "x" })).status).toBe(404);
  });
});
