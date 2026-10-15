import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangelogRoutes, repositoryChangelogPath } from "./changelog.js";
import type { RouteContext } from "./context.js";

describe("changelog routes", () => {
  let rootDir: string;
  let webDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "takode-changelog-"));
    webDir = join(rootDir, "web");
    await mkdir(webDir);
  });

  afterEach(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(rootDir, { recursive: true, force: true }));
  });

  function makeApp() {
    const app = new Hono();
    app.route("/", createChangelogRoutes({ WEB_DIR: webDir } as RouteContext));
    return app;
  }

  it("reads the repository root changelog through async route handling", async () => {
    await writeFile(repositoryChangelogPath(webDir), "# Takode Changelog\n\n## Added\n", "utf8");

    const res = await makeApp().request("/changelog");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      markdown: "# Takode Changelog\n\n## Added\n",
      sourcePath: "CHANGELOG.md",
    });
  });

  it("returns a compact not-found error when the changelog is missing", async () => {
    const res = await makeApp().request("/changelog");
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Changelog file not found" });
  });

  it("keeps the repository changelog bounded to the Takode baseline", async () => {
    // Older history moves to archive files linked from the live changelog to keep it
    // under the file size limit; together they still start at the Takode baseline
    // and never bring back inherited upstream Companion release entries.
    const markdown = await readFile(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    const archive = await readFile(new URL("../../../docs/changelog/2026-04-to-06.md", import.meta.url), "utf8");

    expect(markdown).toContain("(docs/changelog/2026-04-to-06.md)");
    expect(archive).toContain("## 2026-04-10");
    for (const text of [markdown, archive]) {
      expect(text).not.toContain("## [0.46.0]");
      expect(text).not.toContain("the-companion-v0");
    }
  });
});
