import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let tempDir: string;
let memoryStore: typeof import("./workstream-memory-store.js");

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "file-memory-test-"));
  process.env.COMPANION_MEMORY_DIR = join(tempDir, "memory");
  process.env.COMPANION_SERVER_ID = "test-server";
  vi.resetModules();
  memoryStore = await import("./workstream-memory-store.js");
});

afterEach(async () => {
  delete process.env.COMPANION_MEMORY_DIR;
  delete process.env.COMPANION_SERVER_ID;
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
    expect(repo.authoredDirs).toEqual(["current", "knowledge", "procedures", "decisions", "references", "artifacts"]);
    await expect(readFile(join(tempDir, "memory", ".git", "HEAD"), "utf-8")).resolves.toContain("ref:");
  });

  it("derives the catalog from markdown paths and frontmatter without an authored index", async () => {
    await writeMemoryFile(
      "knowledge/service-x.md",
      `
id: service-x
kind: knowledge
title: Service X
summary:
  - Explains Service X config and failure modes.
lifecycle: durable
facets:
  project: takode
  service:
    - service-x
canonical_for:
  - service:service-x
`,
      "Service X is started through a local dev command.",
    );

    const catalog = await memoryStore.scanMemoryCatalog();

    expect(catalog.issues).toEqual([]);
    expect(catalog.entries).toEqual([
      expect.objectContaining({
        id: "service-x",
        kind: "knowledge",
        title: "Service X",
        path: "knowledge/service-x.md",
        facets: { project: ["takode"], service: ["service-x"] },
        canonicalFor: ["service:service-x"],
      }),
    ]);
  });

  it("lints missing frontmatter, duplicate ids, and kind-directory mismatches", async () => {
    await writeMemoryFile(
      "knowledge/service-x.md",
      `
id: duplicated
kind: knowledge
title: Service X
summary: First summary.
lifecycle: durable
`,
    );
    await writeMemoryFile(
      "current/service-x.md",
      `
id: duplicated
kind: knowledge
title: Current Service X
summary: Wrong directory.
lifecycle: active
`,
    );
    await mkdir(join(tempDir, "memory", "decisions"), { recursive: true });
    await writeFile(join(tempDir, "memory", "decisions", "broken.md"), "# Missing frontmatter\n", "utf-8");

    const catalog = await memoryStore.lintMemory();

    expect(catalog.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", message: expect.stringContaining("Duplicate memory id") }),
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining("must match top-level directory"),
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
id: run-service-x
kind: procedures
title: Run Service X
summary: Starts Service X for local validation.
lifecycle: durable
facets:
  project: takode
`,
      "Use bun run dev to launch the service.",
    );
    await writeMemoryFile(
      "knowledge/service-y.md",
      `
id: service-y
kind: knowledge
title: Service Y
summary: Unrelated service notes.
lifecycle: durable
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
    expect(result.matches[0]?.entry.id).toBe("run-service-x");
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
id: takode-memory-current
kind: current
title: Takode memory current state
summary: Captures live state for the memory implementation.
lifecycle: active
`,
    );
    await memoryStore.acquireMemoryLock({ owner: "worker-1" });

    const result = await memoryStore.commitMemory({
      message: "Update memory state",
      quest: "q-1205",
      session: "1537",
      operation: "update",
      memoryIds: ["takode-memory-current"],
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
    expect(stdout).toContain("Memory-Id: takode-memory-current");
    expect(stdout).toContain("Quest: q-1205");
    expect(stdout).toContain("Source: quest:q-1205");
  });
});
