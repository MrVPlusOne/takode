import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function runMemory(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const memoryPath = fileURLToPath(new URL("../bin/memory.ts", import.meta.url));
  const child = spawn(process.execPath, [memoryPath, ...args], {
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR:
        process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun", "install", "cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

describe("memory CLI", () => {
  let tempDir: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memory-cli-test-"));
    env = { COMPANION_MEMORY_DIR: join(tempDir, "memory"), COMPANION_SERVER_ID: "test-server" };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeMemoryFile(path: string, frontmatter: string, body = "Body text."): Promise<void> {
    const absolutePath = join(tempDir, "memory", path);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, `---\n${frontmatter.trim()}\n---\n\n${body}\n`, "utf-8");
  }

  it("initializes, catalogs, and recalls authored memory files", async () => {
    const init = await runMemory(["repo", "init", "--json"], env);
    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout).authoredDirs).toEqual([
      "current",
      "knowledge",
      "procedures",
      "decisions",
      "references",
      "artifacts",
    ]);

    await writeMemoryFile(
      "procedures/run-service-x.md",
      `
id: run-service-x
kind: procedures
title: Run Service X
summary: Starts Service X.
lifecycle: durable
facets:
  project: takode
`,
      "Run bun run dev from the web directory.",
    );

    const catalog = await runMemory(["catalog", "--json"], env);
    expect(catalog.status).toBe(0);
    expect(JSON.parse(catalog.stdout).entries[0]).toEqual(
      expect.objectContaining({ id: "run-service-x", kind: "procedures" }),
    );

    const recall = await runMemory(
      ["recall", "bun service", "--kind", "procedures", "--facet", "project:takode", "--content", "--json"],
      env,
    );
    expect(recall.status).toBe(0);
    expect(JSON.parse(recall.stdout).matches[0].content).toContain("bun run dev");
  });

  it("lints authored files and exits non-zero for schema errors", async () => {
    await runMemory(["repo", "init"], env);
    await mkdir(join(tempDir, "memory", "knowledge"), { recursive: true });
    await writeFile(join(tempDir, "memory", "knowledge", "broken.md"), "# no frontmatter\n", "utf-8");

    const result = await runMemory(["lint", "--json"], env);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must start with YAML frontmatter") }),
    );
  });

  it("supports repo-level lock and commit helpers for direct edits", async () => {
    await runMemory(["repo", "init"], env);
    await writeMemoryFile(
      "current/memory-foundation.md",
      `
id: memory-foundation
kind: current
title: Memory foundation
summary: Tracks the active memory implementation state.
lifecycle: active
`,
    );

    const lock = await runMemory(["lock", "acquire", "--owner", "worker", "--json"], env);
    expect(lock.status).toBe(0);
    expect(JSON.parse(lock.stdout).locked).toBe(true);

    const commit = await runMemory(
      [
        "commit",
        "--message",
        "Record memory foundation",
        "--quest",
        "q-1205",
        "--session",
        "1537",
        "--operation",
        "add",
        "--memory-id",
        "memory-foundation",
        "--source",
        "quest:q-1205",
        "--json",
      ],
      env,
    );
    expect(commit.status).toBe(0);
    expect(JSON.parse(commit.stdout)).toEqual(expect.objectContaining({ committed: true }));

    const status = await runMemory(["status"], env);
    expect(status.stdout.trim()).toBe("clean");

    const release = await runMemory(["lock", "release", "--json"], env);
    expect(JSON.parse(release.stdout).locked).toBe(false);
  });

  it("rejects commit helper calls without lock or required provenance", async () => {
    await runMemory(["repo", "init"], env);
    await writeMemoryFile(
      "current/provenance.md",
      `
id: provenance
kind: current
title: Provenance
summary: Tracks memory commit provenance validation.
lifecycle: active
`,
    );

    const noLock = await runMemory(
      ["commit", "--message", "Missing lock", "--memory-id", "provenance", "--source", "quest:q-1205"],
      env,
    );
    expect(noLock.status).toBe(1);
    expect(noLock.stderr).toContain("Acquire the memory repo lock");

    await runMemory(["lock", "acquire", "--owner", "worker"], env);

    const missingSource = await runMemory(["commit", "--message", "Missing source", "--memory-id", "provenance"], env);
    expect(missingSource.status).toBe(1);
    expect(missingSource.stderr).toContain("at least one source trailer");

    const missingTraceability = await runMemory(
      ["commit", "--message", "Missing traceability", "--source", "quest:q-1205"],
      env,
    );
    expect(missingTraceability.status).toBe(1);
    expect(missingTraceability.stderr).toContain("include quest, session, or at least one memory id");
  });

  it("rejects superseded workstream/upsert/check commands with migration guidance", async () => {
    const result = await runMemory(["upsert", "current", "takode/key"], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("old workstream-memory CLI was superseded");
    expect(result.stderr).toContain("catalog/recall/lint/lock/commit");
  });
});
