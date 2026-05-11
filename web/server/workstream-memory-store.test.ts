import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let tempDir: string;
let memoryStore: typeof import("./workstream-memory-store.js");
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "file-memory-test-"));
  originalHome = process.env.HOME;
  process.env.COMPANION_MEMORY_DIR = join(tempDir, "memory");
  process.env.COMPANION_SERVER_ID = "test-server";
  process.env.COMPANION_SERVER_SLUG = "test";
  delete process.env.COMPANION_MEMORY_SPACE_SLUG;
  memoryStore = await import("./workstream-memory-store.js");
});

afterEach(async () => {
  delete process.env.COMPANION_MEMORY_DIR;
  delete process.env.COMPANION_SERVER_ID;
  delete process.env.COMPANION_SERVER_SLUG;
  delete process.env.COMPANION_MEMORY_SPACE_SLUG;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

async function writeMemoryFile(path: string, frontmatter: string, body = "Body text."): Promise<void> {
  const absolutePath = join(tempDir, "memory", path);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, `---\n${frontmatter.trim()}\n---\n\n${body}\n`, "utf-8");
}

describe("file-based memory store", () => {
  it("initializes one git-backed memory repo with the accepted authored directories", async () => {
    const repo = await memoryStore.ensureMemoryRepo();

    expect(repo.root).toBe(join(tempDir, "memory"));
    expect(repo.serverId).toBe("test-server");
    expect(repo.serverSlug).toBe("test");
    expect(repo.sessionSpaceSlug).toBe("Takode");
    expect(repo.authoredDirs).toEqual(["current", "knowledge", "procedures", "decisions", "references", "artifacts"]);
    await expect(readFile(join(tempDir, "memory", ".git", "HEAD"), "utf-8")).resolves.toContain("ref:");
  });

  it("migrates an existing server-id memory repo to the server slug path", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const legacyRoot = join(tempDir, ".companion", "memory", "test-server");
    await mkdir(join(legacyRoot, "knowledge"), { recursive: true });
    await writeFile(
      join(legacyRoot, "knowledge", "legacy.md"),
      `---
description: Migrated from the server-id path.
source:
  - q-1217
---

Body.
`,
      "utf-8",
    );

    const repo = await memoryStore.ensureMemoryRepo();

    expect(repo.root).toBe(join(tempDir, ".companion", "memory", "test", "Takode"));
    await expect(readFile(join(repo.root, "knowledge", "legacy.md"), "utf-8")).resolves.toContain("server-id path");
    await expect(readFile(join(legacyRoot, "knowledge", "legacy.md"), "utf-8")).rejects.toThrow();
  });

  it("does not let an empty initialized slug repo block server-id repo migration", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const legacyRoot = join(tempDir, ".companion", "memory", "test-server");
    const targetRoot = join(tempDir, ".companion", "memory", "test", "Takode");
    await mkdir(join(targetRoot, ".git"), { recursive: true });
    await mkdir(join(targetRoot, "current"), { recursive: true });
    await mkdir(join(legacyRoot, "knowledge"), { recursive: true });
    await writeFile(
      join(legacyRoot, "knowledge", "legacy.md"),
      `---
description: Migrated even when the target slug was initialized empty.
source:
  - q-1217
---

Body.
`,
      "utf-8",
    );

    const repo = await memoryStore.ensureMemoryRepo();

    expect(repo.root).toBe(targetRoot);
    await expect(readFile(join(repo.root, "knowledge", "legacy.md"), "utf-8")).resolves.toContain("initialized empty");
    await expect(readFile(join(legacyRoot, "knowledge", "legacy.md"), "utf-8")).rejects.toThrow();
  });

  it("migrates an existing flat server-slug repo into the default session-space path", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const flatRoot = join(tempDir, ".companion", "memory", "test");
    await mkdir(join(flatRoot, "knowledge"), { recursive: true });
    await writeFile(
      join(flatRoot, "knowledge", "flat.md"),
      `---
description: Migrated from the flat server-slug path.
source:
  - q-1237
---

Body.
`,
      "utf-8",
    );

    const repo = await memoryStore.ensureMemoryRepo();

    expect(repo.root).toBe(join(tempDir, ".companion", "memory", "test", "Takode"));
    await expect(readFile(join(repo.root, "knowledge", "flat.md"), "utf-8")).resolves.toContain(
      "flat server-slug path",
    );
    await expect(readFile(join(flatRoot, "knowledge", "flat.md"), "utf-8")).rejects.toThrow();
  });

  it("rejects flat-to-session-space migration conflicts before rewriting the server index", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const flatRoot = join(tempDir, ".companion", "memory", "test");
    const nestedRoot = join(flatRoot, "Takode");
    const indexPath = join(tempDir, ".companion", "memory", ".servers", "test-server", "Takode.json");
    await mkdir(join(flatRoot, "current"), { recursive: true });
    await mkdir(join(nestedRoot, "current"), { recursive: true });
    await writeFile(
      join(flatRoot, "current", "flat.md"),
      `---
description: Existing flat memory.
source:
  - q-1237
---

Flat memory.
`,
      "utf-8",
    );
    await writeFile(
      join(nestedRoot, "current", "nested.md"),
      `---
description: Existing nested memory.
source:
  - q-1237
---

Nested memory.
`,
      "utf-8",
    );

    await expect(memoryStore.ensureMemoryRepo()).rejects.toThrow('Memory repo space "test/Takode" already exists');

    await expect(readFile(join(flatRoot, "current", "flat.md"), "utf-8")).resolves.toContain("Flat memory");
    await expect(readFile(join(nestedRoot, "current", "nested.md"), "utf-8")).resolves.toContain("Nested memory");
    await expect(readFile(indexPath, "utf-8")).rejects.toThrow();
  });

  it("migrates from an indexed old slug when the server slug is renamed", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const oldRoot = join(tempDir, ".companion", "memory", "old-slug", "Takode");
    process.env.COMPANION_SERVER_SLUG = "old-slug";
    await memoryStore.ensureMemoryRepo();
    await mkdir(join(oldRoot, "current"), { recursive: true });
    await writeFile(
      join(oldRoot, "current", "rename.md"),
      `---
description: Survives a slug rename.
source:
  - q-1217
---

Body text.
`,
      "utf-8",
    );

    process.env.COMPANION_SERVER_SLUG = "new-slug";
    const repo = await memoryStore.ensureMemoryRepo();

    expect(repo.root).toBe(join(tempDir, ".companion", "memory", "new-slug", "Takode"));
    await expect(readFile(join(repo.root, "current", "rename.md"), "utf-8")).resolves.toContain("Survives");
    await expect(readFile(join(oldRoot, "current", "rename.md"), "utf-8")).rejects.toThrow();
  });

  it("does not migrate an indexed repo from another session space", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    process.env.COMPANION_SERVER_ID = "same-server";
    process.env.COMPANION_SERVER_SLUG = "prod";
    process.env.COMPANION_MEMORY_SPACE_SLUG = "Takode";
    const takodeRoot = join(tempDir, ".companion", "memory", "prod", "Takode");
    const otherRoot = join(tempDir, ".companion", "memory", "prod", "Other");

    await memoryStore.ensureMemoryRepo();
    await mkdir(join(takodeRoot, "current"), { recursive: true });
    await writeFile(
      join(takodeRoot, "current", "takode.md"),
      `---
description: Belongs to the Takode session space.
source:
  - q-1331
---

Takode-owned memory.
`,
      "utf-8",
    );

    process.env.COMPANION_MEMORY_SPACE_SLUG = "Other";
    const otherRepo = await memoryStore.ensureMemoryRepo();

    expect(otherRepo.root).toBe(otherRoot);
    expect(otherRepo.sessionSpaceSlug).toBe("Other");
    await expect(readFile(join(takodeRoot, "current", "takode.md"), "utf-8")).resolves.toContain("Takode-owned memory");
    await expect(readFile(join(otherRoot, "current", "takode.md"), "utf-8")).rejects.toThrow();

    const takodeIndex = JSON.parse(
      await readFile(join(tempDir, ".companion", "memory", ".servers", "same-server", "Takode.json"), "utf-8"),
    );
    const otherIndex = JSON.parse(
      await readFile(join(tempDir, ".companion", "memory", ".servers", "same-server", "Other.json"), "utf-8"),
    );
    expect(takodeIndex).toEqual(expect.objectContaining({ sessionSpaceSlug: "Takode", root: takodeRoot }));
    expect(otherIndex).toEqual(expect.objectContaining({ sessionSpaceSlug: "Other", root: otherRoot }));
  });

  it("rejects rename to a non-empty slug without rewriting the server index", async () => {
    delete process.env.COMPANION_MEMORY_DIR;
    process.env.HOME = tempDir;
    const oldRoot = join(tempDir, ".companion", "memory", "old-slug", "Takode");
    const collisionRoot = join(tempDir, ".companion", "memory", "new-slug", "Takode");
    const indexPath = join(tempDir, ".companion", "memory", ".servers", "test-server", "Takode.json");

    process.env.COMPANION_SERVER_SLUG = "old-slug";
    await memoryStore.ensureMemoryRepo();
    await mkdir(join(oldRoot, "current"), { recursive: true });
    await writeFile(
      join(oldRoot, "current", "server-a.md"),
      `---
description: Must not be stranded by a colliding slug rename.
source:
  - q-1217
---

Server A memory.
`,
      "utf-8",
    );

    await mkdir(join(collisionRoot, "current"), { recursive: true });
    await writeFile(
      join(collisionRoot, "current", "server-b.md"),
      `---
description: Existing memory owned by another slug.
source:
  - q-1217
---

Server B memory.
`,
      "utf-8",
    );

    process.env.COMPANION_SERVER_SLUG = "new-slug";
    await expect(memoryStore.ensureMemoryRepo()).rejects.toThrow('Memory repo space "new-slug/Takode" already exists');

    await expect(readFile(join(oldRoot, "current", "server-a.md"), "utf-8")).resolves.toContain("Server A memory");
    await expect(readFile(join(collisionRoot, "current", "server-b.md"), "utf-8")).resolves.toContain(
      "Server B memory",
    );
    const index = JSON.parse(await readFile(indexPath, "utf-8"));
    expect(index.serverSlug).toBe("old-slug");
    expect(index.root).toBe(oldRoot);
  });

  it("derives the catalog from markdown paths and frontmatter without an authored index", async () => {
    await writeMemoryFile(
      "knowledge/service-x.md",
      `
description: Explains Service X config and failure modes.
source:
  - q-1220
facets:
  project: takode
  service:
    - service-x
`,
      "Service X is started through a local dev command.",
    );

    const catalog = await memoryStore.scanMemoryCatalog();

    expect(catalog.issues).toEqual([]);
    expect(catalog.entries).toEqual([
      expect.objectContaining({
        id: "knowledge/service-x.md",
        kind: "knowledge",
        description: "Explains Service X config and failure modes.",
        path: "knowledge/service-x.md",
        source: ["q-1220"],
        facets: { project: ["takode"], service: ["service-x"] },
      }),
    ]);
  });

  it("lints missing frontmatter, missing simplified fields, and obsolete old-schema fields", async () => {
    await writeMemoryFile(
      "knowledge/service-x.md",
      `
description: First summary.
`,
    );
    await writeMemoryFile(
      "current/service-x.md",
      `
id: old-schema
kind: current
title: Current Service X
summary: Wrong directory.
lifecycle: active
source: [q-1220]
`,
    );
    await mkdir(join(tempDir, "memory", "decisions"), { recursive: true });
    await writeFile(join(tempDir, "memory", "decisions", "broken.md"), "# Missing frontmatter\n", "utf-8");

    const catalog = await memoryStore.lintMemory();

    expect(catalog.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "Memory source must list at least one contributing quest or session ref",
        }),
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining('Obsolete memory frontmatter field "id"'),
        }),
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining("must start with YAML frontmatter"),
        }),
      ]),
    );
  });

  it("recalls matching files by query, kind, facet, and optional content", async () => {
    await writeMemoryFile(
      "procedures/run-service-x.md",
      `
description: Starts Service X for local validation.
source:
  - q-1220
facets:
  project: takode
`,
      "Use bun run dev to launch the service.",
    );
    await writeMemoryFile(
      "knowledge/service-y.md",
      `
description: Unrelated service notes.
source:
  - q-1220
facets:
  project: other
`,
    );

    const result = await memoryStore.recallMemory({
      query: "bun service",
      kinds: ["procedures"],
      facets: { project: ["takode"] },
      includeContent: true,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.entry.id).toBe("procedures/run-service-x.md");
    expect(result.matches[0]?.content).toContain("bun run dev");
  });

  it("serializes direct edits with one repo-level write lock", async () => {
    const first = await memoryStore.acquireMemoryLock({ owner: "worker-1", ttlMs: 30_000 });
    expect(first.locked).toBe(true);
    await expect(memoryStore.acquireMemoryLock({ owner: "worker-2", ttlMs: 30_000 })).rejects.toThrow("already locked");

    const status = await memoryStore.getMemoryLock();
    expect(status.owner).toBe("worker-1");

    const released = await memoryStore.releaseMemoryLock();
    expect(released.locked).toBe(false);
  });

  it("stages authored memory files and commits with source trailers", async () => {
    await writeMemoryFile(
      "current/takode-memory.md",
      `
description: Captures live state for the memory implementation.
source:
  - q-1205
`,
    );
    await memoryStore.acquireMemoryLock({ owner: "worker-1" });

    const result = await memoryStore.commitMemory({
      message: "Update memory state",
      quest: "q-1205",
      session: "1537",
      operation: "update",
      memoryIds: ["current/takode-memory.md"],
      sources: ["quest:q-1205"],
    });

    expect(result.committed).toBe(true);
    expect(result.sha).toMatch(/[a-f0-9]+/);
    const { stdout } = await execFileAsync("git", [
      "--no-optional-locks",
      "-C",
      join(tempDir, "memory"),
      "log",
      "-1",
      "--pretty=%B",
    ]);
    expect(stdout).toContain("Memory-Operation: update");
    expect(stdout).toContain("Memory-Id: current/takode-memory.md");
    expect(stdout).toContain("Quest: q-1205");
    expect(stdout).toContain("Source: quest:q-1205");
  });

  it("rejects store-level commits without a non-stale memory lock", async () => {
    await writeMemoryFile(
      "current/no-lock.md",
      `
description: Captures a missing lock case.
source:
  - q-1205
`,
    );

    await expect(
      memoryStore.commitMemory({
        message: "Try memory commit without lock",
        memoryIds: ["current/no-lock.md"],
        sources: ["quest:q-1205"],
      }),
    ).rejects.toThrow("Acquire the memory repo lock before committing");
  });

  it("rejects store-level commits with a stale memory lock", async () => {
    await writeMemoryFile(
      "current/stale-lock.md",
      `
description: Captures a stale lock case.
source:
  - q-1205
`,
    );
    await memoryStore.acquireMemoryLock({ owner: "worker-1", ttlMs: -1 });

    await expect(
      memoryStore.commitMemory({
        message: "Try memory commit with stale lock",
        memoryIds: ["current/stale-lock.md"],
        sources: ["quest:q-1205"],
      }),
    ).rejects.toThrow("Memory repo lock is stale");
  });

  it("rejects memory commits without required provenance", async () => {
    await writeMemoryFile(
      "current/provenance.md",
      `
description: Captures provenance validation.
source:
  - q-1205
`,
    );
    await memoryStore.acquireMemoryLock({ owner: "worker-1" });

    await expect(
      memoryStore.commitMemory({
        message: "Missing source",
        memoryIds: ["current/provenance.md"],
      }),
    ).rejects.toThrow("at least one source trailer");

    await expect(
      memoryStore.commitMemory({
        message: "Missing traceability",
        sources: ["quest:q-1205"],
      }),
    ).rejects.toThrow("include quest, session, or at least one memory id");
  });
});
