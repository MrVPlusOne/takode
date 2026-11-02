import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "../remote-host/host-agent.js";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { configureRemoteMachines } from "../remote-host/session-machine.js";
import { createFileLinkBrowserRoutes } from "./file-link-browser.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * HTML file links from a session on a remote host (one run by `takode node`) open
 * like local ones. They used to be refused with "files on remote hosts can't be
 * browsed yet", seen with a Codex session on a host running as root that linked
 * `/root/.codex/worktrees/<id>/<repo>/report.html:1`. The "remote" host is an
 * in-process HostAgent reached only through the host link, so stopping it proves
 * the route reads through the host; every file lives under a temporary directory.
 */
describe("HTML file links from a session on a remote host", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent;
  let dir: string;
  let worktree: string;
  let app: Hono;

  const openUrl = (path: string) =>
    `/file-preview/open?${new URLSearchParams({ path, isRelative: "0", sessionId: "remote" })}`;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "file-link-browser-remote-")));
    // The path shape from the report: a Codex worktree under the host user's home.
    worktree = join(dir, "root", ".codex", "worktrees", "a1b2", "project");
    await mkdir(join(worktree, "assets"), { recursive: true });
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
      remote: { state: { cwd: worktree, repo_root: worktree, is_worktree: false, host_id: hostId } },
    };
    app = new Hono();
    app.route(
      "/",
      createFileLinkBrowserRoutes({ getSession: (id: string) => sessions[id] ?? null } as never, {
        hostName: async (id) => (id === hostId ? "gpu-box" : undefined),
      }),
    );
  });

  afterEach(async () => {
    agent.stop();
    configureRemoteMachines(null);
    await rm(dir, { recursive: true, force: true });
  });

  it("opens the page and its relative assets from the host", async () => {
    const html = '<!doctype html><link rel="stylesheet" href="./assets/report.css"><p>Report</p>';
    await writeFile(join(worktree, "report.html"), html);
    await writeFile(join(worktree, "assets", "report.css"), "p { color: teal; }\n");

    const entry = await app.request(openUrl(join(worktree, "report.html")));
    expect(entry.status).toBe(302);
    const contentPath = new URL(entry.headers.get("Location") ?? "", "http://localhost").pathname;

    const page = await app.request(contentPath);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(html);
    // Served from a remote host, the page keeps the same sandbox as a local one.
    expect(page.headers.get("Content-Security-Policy")).toContain("allow-scripts");
    expect(page.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");

    const css = await app.request(new URL("./assets/report.css", `http://localhost${contentPath}`).pathname);
    expect(css.status).toBe(200);
    expect(await css.text()).toBe("p { color: teal; }\n");
  });

  it("resolves symlinks on the host and refuses one that leaves the session folder", async () => {
    // A symlinked asset pointing outside the worktree must stay unreachable, as it is locally.
    await writeFile(join(dir, "secret.txt"), "not for the page\n");
    await symlink(join(dir, "secret.txt"), join(worktree, "assets", "data.txt"));
    await writeFile(join(worktree, "report.html"), '<!doctype html><img src="./assets/data.txt">');

    const entry = await app.request(openUrl(join(worktree, "report.html")));
    expect(entry.status).toBe(302);
    const contentPath = new URL(entry.headers.get("Location") ?? "", "http://localhost").pathname;
    const escaped = await app.request(new URL("./assets/data.txt", `http://localhost${contentPath}`).pathname);
    expect(escaped.status).toBe(403);
  });

  it("says which host is offline instead of refusing remote files", async () => {
    await writeFile(join(worktree, "report.html"), "<p>Report</p>");
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);

    const response = await app.request(openUrl(join(worktree, "report.html")));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Cannot open HTML file: it is on gpu-box, which is offline");
  });
});
