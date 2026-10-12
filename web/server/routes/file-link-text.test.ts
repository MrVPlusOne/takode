import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "../remote-host/host-agent.js";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { configureRemoteMachines } from "../remote-host/session-machine.js";
import type { RouteContext } from "./context.js";
import { createFilesystemRoutes } from "./filesystem.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Takode shows a linked Markdown file itself instead of handing it to a local
 * editor (which a phone does not have, and which cannot reach another machine).
 * `GET /api/fs/file-link/text` reads the file where the linking session's files
 * live: this machine, or its remote host. The "remote" host here is an in-process
 * HostAgent reached only through the host link, so a passing remote read proves
 * the route asked the host; every file lives under a temporary directory.
 */
describe("GET /api/fs/file-link/text", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent;
  let dir: string;
  let app: Hono;

  const textUrl = (path: string, opts: { relative?: boolean; sessionId?: string } = {}) =>
    `/api/fs/file-link/text?path=${encodeURIComponent(path)}&isRelative=${opts.relative ? "1" : "0"}${
      opts.sessionId ? `&sessionId=${opts.sessionId}` : ""
    }`;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "file-link-text-")));
    manager = new HostLinkManager();
    configureRemoteMachines(manager);
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(manager, hostId).agentSide,
    });
    agent.start();
    await waitFor(() => manager.status(hostId).online);

    const sessions: Record<string, { state: Record<string, unknown> }> = {
      local: { state: { cwd: dir, repo_root: dir, is_worktree: false } },
      remote: {
        state: {
          cwd: dir,
          repo_root: dir,
          is_worktree: false,
          host_id: hostId,
        },
      },
    };
    const ctx = {
      launcher: {
        remoteHosts: {
          registry: {
            get: async (id: string) => ({ id, name: "devbox", createdAt: 0 }),
          },
        },
      },
      wsBridge: { getSession: (sessionId: string) => sessions[sessionId] },
      execAsync: async () => "",
      execCaptureStdoutAsync: async () => "",
    } as unknown as RouteContext;
    app = new Hono();
    app.route("/api", createFilesystemRoutes(ctx));
  });

  afterEach(async () => {
    agent.stop();
    configureRemoteMachines(null);
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an absolute linked file's text, and resolves relative links against the session root", async () => {
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "briefing.md"), "# Briefing\n\nAll good.\n");

    const absolute = await app.request(textUrl(join(dir, "docs", "briefing.md")));
    expect(absolute.status).toBe(200);
    expect(await absolute.json()).toEqual({
      absolutePath: join(dir, "docs", "briefing.md"),
      content: "# Briefing\n\nAll good.\n",
    });

    const relative = await app.request(textUrl("docs/briefing.md", { relative: true, sessionId: "local" }));
    expect(await relative.json()).toMatchObject({
      absolutePath: join(dir, "docs", "briefing.md"),
    });
  });

  it("reads a remote session's file on its host", async () => {
    const request = vi.spyOn(manager, "request");
    const file = join(dir, "report.md");
    await writeFile(file, "remote report\n");

    const res = await app.request(textUrl(file, { sessionId: "remote" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      absolutePath: file,
      content: "remote report\n",
    });
    expect(request).toHaveBeenCalledWith(
      hostId,
      expect.objectContaining({ kind: "read_file", path: file }),
      expect.any(Number),
    );
  });

  // Missing files, folders and oversized files fail with a message the viewer can show.
  it("rejects missing files, folders and files over 2 MB", async () => {
    const missing = await app.request(textUrl(join(dir, "missing.md")));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "File not found" });

    const folder = await app.request(textUrl(dir));
    expect(folder.status).toBe(400);
    expect(await folder.json()).toMatchObject({ error: "Not a file" });

    await writeFile(join(dir, "huge.md"), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    const huge = await app.request(textUrl(join(dir, "huge.md")));
    expect(huge.status).toBe(413);
  });

  // An offline host is named, rather than its file being reported as missing.
  it("reports an offline host by name", async () => {
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);

    const res = await app.request(textUrl(join(dir, "report.md"), { sessionId: "remote" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Host devbox is offline" });
  });
});
