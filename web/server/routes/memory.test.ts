import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

describe("memory routes", () => {
  let home: string;

  beforeEach(() => {
    vi.resetModules();
  });

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "memory-routes-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("COMPANION_SERVER_ID", "server-test");
    vi.stubEnv("COMPANION_SERVER_SLUG", "prod");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  async function makeApp() {
    const { createMemoryRoutes } = await import("./memory.js");
    const app = new Hono();
    app.route("/", createMemoryRoutes({} as never));
    return app;
  }

  async function writeMemoryFile(
    slug: string,
    path: string,
    frontmatter: string,
    body = "Body text.",
  ): Promise<string> {
    const absolutePath = join(home, ".companion", "memory", slug, path);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, `---\n${frontmatter.trim()}\n---\n\n${body}\n`, "utf-8");
    return absolutePath;
  }

  it("lists the current server-slug space first and discovers sibling memory repos", async () => {
    // Verifies the browser can offer memory-space selection without depending on the memory CLI.
    await writeMemoryFile(
      "dev",
      "current/dev-state.md",
      `
description: Dev server memory.
source:
  - q-1220
`,
    );

    const app = await makeApp();
    const res = await app.request("/memory/spaces");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.currentServerSlug).toBe("prod");
    expect(json.spaces[0]).toMatchObject({
      slug: "prod",
      current: true,
      initialized: true,
      root: join(home, ".companion", "memory", "prod"),
    });
    expect(json.spaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "dev",
          current: false,
          hasAuthoredData: true,
        }),
      ]),
    );
  });

  it("returns catalog health, lock, dirty status, provenance, and recent commits", async () => {
    // Verifies the Memory view can show catalog-first orientation plus freshness/health signals.
    await writeMemoryFile(
      "prod",
      "knowledge/service-x.md",
      `
description: Explains Service X config and failure modes.
source:
  - q-1220
facets:
  project: takode
`,
      "Service X is started through a local dev command.",
    );
    const { ensureMemoryRepo } = await import("../workstream-memory-store.js");
    const repo = await ensureMemoryRepo();
    await execFileAsync("git", ["--no-optional-locks", "-C", repo.root, "add", "--", "knowledge"]);
    await execFileAsync("git", [
      "--no-optional-locks",
      "-C",
      repo.root,
      "-c",
      "user.name=Takode Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "Seed memory",
    ]);
    await writeMemoryFile(
      "prod",
      "current/live.md",
      `
description: Captures dirty working state.
source:
  - session:1576
`,
    );

    const app = await makeApp();
    const res = await app.request("/memory/catalog?serverSlug=prod");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.repo.serverSlug).toBe("prod");
    expect(json.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "knowledge/service-x.md",
          kind: "knowledge",
          source: ["q-1220"],
          facets: { project: ["takode"] },
        }),
        expect.objectContaining({ path: "current/live.md" }),
      ]),
    );
    expect(json.issueCounts).toEqual({ errors: 0, warnings: 0 });
    expect(json.lock).toMatchObject({ locked: false });
    expect(json.git.dirty).toBe(true);
    expect(json.git.statusEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "current/live.md" })]),
    );
    expect(json.git.recentCommits[0]).toMatchObject({ message: "Seed memory" });
  });

  it("returns read-only record details and per-record lint issues", async () => {
    // Verifies detail drill-in returns parsed Markdown metadata and body content.
    await writeMemoryFile(
      "prod",
      "procedures/run-service.md",
      `
description: Starts the local service.
source: q-1220
`,
      "Run `bun run dev` from the web directory.",
    );

    const app = await makeApp();
    const res = await app.request(
      `/memory/records?serverSlug=prod&path=${encodeURIComponent("procedures/run-service.md")}`,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.file).toMatchObject({
      path: "procedures/run-service.md",
      kind: "procedures",
      description: "Starts the local service.",
      source: ["q-1220"],
      body: "Run `bun run dev` from the web directory.",
    });
    expect(json.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        path: "procedures/run-service.md",
        message: "Memory source must be a YAML list of contributing quest or session refs",
      }),
    ]);
  });

  it("rejects record reads outside authored memory paths", async () => {
    // Verifies the route does not become a generic filesystem read endpoint.
    const app = await makeApp();

    const traversal = await app.request(`/memory/records?path=${encodeURIComponent("../prod/.git/config")}`);
    expect(traversal.status).toBe(400);

    const nonMarkdown = await app.request(`/memory/records?path=${encodeURIComponent("current/not-memory.txt")}`);
    expect(nonMarkdown.status).toBe(400);
  });

  it("rejects symlinked Markdown files that resolve outside the memory repo", async () => {
    // Verifies safe record reads canonicalize the final target before reading.
    const outsideDir = join(home, "outside");
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = join(outsideDir, "secret.md");
    await writeFile(outsideFile, "outside content must not leak", "utf-8");
    const linkPath = join(home, ".companion", "memory", "prod", "current", "leak.md");
    await mkdir(join(linkPath, ".."), { recursive: true });
    await symlink(outsideFile, linkPath);

    const app = await makeApp();
    const res = await app.request(`/memory/records?serverSlug=prod&path=${encodeURIComponent("current/leak.md")}`);
    const body = await res.text();

    expect(res.status).toBe(400);
    expect(body).toContain("must stay inside the memory repo");
    expect(body).not.toContain("outside content must not leak");
  });

  it("rejects symlinked directory escapes before reading nested Markdown records", async () => {
    // Verifies directory symlinks cannot bypass authored-directory confinement.
    const outsideDir = join(home, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "nested.md"), "nested outside content must not leak", "utf-8");
    const linkPath = join(home, ".companion", "memory", "prod", "current", "escape");
    await mkdir(join(linkPath, ".."), { recursive: true });
    await symlink(outsideDir, linkPath);

    const app = await makeApp();
    const res = await app.request(
      `/memory/records?serverSlug=prod&path=${encodeURIComponent("current/escape/nested.md")}`,
    );
    const body = await res.text();

    expect(res.status).toBe(400);
    expect(body).toContain("must stay inside the memory repo");
    expect(body).not.toContain("nested outside content must not leak");
  });
});
