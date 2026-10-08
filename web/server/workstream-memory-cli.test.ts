import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCliWriteServer, type CliWriteServer } from "./test-fixtures/cli-write-server-harness.js";

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
  // The server runs every memory command that writes, including catalog reads that record
  // freshness and handles, so each test gets a real write server over its disposable HOME.
  const servers: CliWriteServer[] = [];

  /** Start a write server over this test's HOME whose own server slug is `serverSlug`. */
  async function serverPort(serverSlug: string): Promise<string> {
    const server = await startCliWriteServer(tempDir, { serverSlug });
    servers.push(server);
    return String(server.port);
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memory-cli-test-"));
    env = {
      HOME: tempDir,
      COMPANION_MEMORY_DIR: join(tempDir, "memory"),
      COMPANION_SERVER_ID: "test-server",
      COMPANION_SERVER_SLUG: "test",
      COMPANION_PORT: await serverPort("test"),
    };
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeMemoryFile(path: string, frontmatter: string, body = "Body text."): Promise<void> {
    const absolutePath = join(tempDir, "memory", path);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, `---\n${frontmatter.trim()}\n---\n\n${body}\n`, "utf-8");
  }

  it("auto-initializes and catalogs authored memory files", async () => {
    await writeMemoryFile(
      "procedures/run-service-x.md",
      `
description: Starts Service X.
source:
  - q-1218
facets:
  project: takode
`,
      "Run bun run dev from the web directory.",
    );

    const catalog = await runMemory(["catalog", "--json"], env);
    expect(catalog.status).toBe(0);
    const catalogJson = JSON.parse(catalog.stdout);
    expect(catalogJson.repo).toEqual(
      expect.objectContaining({
        root: join(tempDir, "memory"),
        serverId: "test-server",
        serverSlug: "test",
        sessionSpaceSlug: "Takode",
        initialized: true,
        // Only folders that exist are reported; new repos pre-create none.
        authoredDirs: ["procedures"],
      }),
    );
    await expect(readFile(join(tempDir, "memory", ".git", "HEAD"), "utf-8")).resolves.toContain("ref:");
    expect(catalogJson.entries[0]).toEqual(
      expect.objectContaining({
        id: "procedures/run-service-x.md",
        type: "procedure",
        description: "Starts Service X.",
        source: ["q-1218"],
      }),
    );
  });

  it("shows catalog entries relative to the printed memory repo root", async () => {
    await writeMemoryFile(
      "decisions/memory-schema.md",
      `
description: Memory frontmatter is intentionally small and path-derived.
source: [q-1220, session:1559]
`,
      "Use the catalog for orientation and direct file tools for details.",
    );

    const catalog = await runMemory(["catalog", "show"], env);

    expect(catalog.status).toBe(0);
    expect(catalog.stdout).toContain(`Memory repo: ${join(tempDir, "memory")}`);
    expect(catalog.stdout).toContain(
      "decisions/memory-schema.md: Memory frontmatter is intentionally small and path-derived.",
    );
    expect(catalog.stdout).not.toContain("[decisions]");
    expect(catalog.stdout).not.toContain("source: q-1220, session:1559");
    expect(catalog.stdout).not.toContain(join(tempDir, "memory", "decisions", "memory-schema.md"));

    const catalogJson = await runMemory(["catalog", "show", "--json"], env);
    expect(catalogJson.status).toBe(0);
    expect(JSON.parse(catalogJson.stdout).entries[0]).toEqual(
      expect.objectContaining({
        id: "decisions/memory-schema.md",
        type: "decision",
        source: ["q-1220", "session:1559"],
      }),
    );
  });

  it("reports catalog changes since this session last saw the catalog", async () => {
    const scopedEnv = { ...env, COMPANION_SESSION_ID: "session-a" };
    await writeMemoryFile(
      "decisions/first.md",
      `
description: First catalog entry.
source:
  - q-1237
`,
    );

    const firstDiff = await runMemory(["catalog", "diff"], scopedEnv);
    expect(firstDiff.status).toBe(0);
    expect(firstDiff.stdout).toContain("No prior catalog snapshot for this session");
    expect(firstDiff.stdout).toContain("added: decisions/first.md First catalog entry.");

    const show = await runMemory(["catalog", "show"], scopedEnv);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain("decisions/first.md: First catalog entry.");

    await writeMemoryFile(
      "decisions/first.md",
      `
description: Updated catalog entry.
source:
  - q-1237
`,
    );
    await writeMemoryFile(
      "procedures/second.md",
      `
description: Second catalog entry.
source:
  - q-1237
`,
    );

    const secondDiff = await runMemory(["catalog", "diff"], scopedEnv);
    expect(secondDiff.status).toBe(0);
    expect(secondDiff.stdout).toContain("Catalog changes since");
    expect(secondDiff.stdout).toContain("changed: decisions/first.md Updated catalog entry.");
    expect(secondDiff.stdout).toContain("added: procedures/second.md Second catalog entry.");

    const cleanDiff = await runMemory(["catalog", "diff"], scopedEnv);
    expect(cleanDiff.status).toBe(0);
    expect(cleanDiff.stdout).toContain("No catalog changes since last seen.");
  });

  it("reports body-only edits compactly and upgrades legacy freshness without a false clean result", async () => {
    const scopedEnv = { ...env, COMPANION_SESSION_ID: "body-reader" };
    const path = "decisions/body-version.md";
    const frontmatter = "description: Read for the current rule.\nsource: [session:test]";
    await writeMemoryFile(path, frontmatter, "Original body.");
    const show = await runMemory(["catalog", "show", "--json"], scopedEnv);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout)).not.toHaveProperty("contentHashes");

    // A large changed body must affect freshness without being echoed by either output format.
    const changedBody = "BODY_DETAIL_ONLY ".repeat(2_000);
    await writeMemoryFile(path, frontmatter, changedBody);
    const changed = await runMemory(["catalog", "diff"], scopedEnv);
    expect(changed.status).toBe(0);
    expect(changed.stdout).toContain(`changed: ${path} Read for the current rule.`);
    expect(changed.stdout).not.toContain("BODY_DETAIL_ONLY");
    expect(changed.stdout.length).toBeLessThan(1_000);

    const seenPath = join(tempDir, "memory", ".git", "takode-memory-catalog-seen", "body-reader.json");
    const snapshot = JSON.parse(await readFile(seenPath, "utf-8"));
    expect(snapshot.contentHashes[path]).toMatch(/^[a-f0-9]{64}$/);
    // Pre-upgrade watermarks have the same metadata but no evidence of body versions.
    delete snapshot.contentHashes;
    await writeFile(seenPath, JSON.stringify(snapshot));
    const legacy = await runMemory(["catalog", "diff", "--json"], scopedEnv);
    expect(legacy.status).toBe(0);
    const legacyJson = JSON.parse(legacy.stdout);
    expect(legacyJson.changes).toEqual([expect.objectContaining({ kind: "changed", path })]);
    expect(legacy.stdout).not.toContain("contentHashes");
    expect(legacy.stdout).not.toContain("BODY_DETAIL_ONLY");
    const clean = await runMemory(["catalog", "diff", "--json"], scopedEnv);
    expect(JSON.parse(clean.stdout).changes).toEqual([]);
  });

  it("rejects overlong descriptions in lint and commit without hiding or truncating records", async () => {
    const path = "decisions/description-limit.md";
    // Count Unicode code points, not UTF-16 units: exactly 250 remains valid. The note is
    // uncommitted, so lint treats it as part of the next commit and reports an error.
    const accepted = "🦊".repeat(250);
    const overlong = accepted + "!";
    await writeMemoryFile(path, `description: ${accepted}\nsource: [session:test]`);
    expect((await runMemory(["lint"], env)).status).toBe(0);
    await writeMemoryFile(path, `description: ${overlong}\nsource: [session:test]`);
    const lint = await runMemory(["lint", "--json"], env);
    expect(lint.status).toBe(1);
    expect(JSON.parse(lint.stdout).issues).toContainEqual(
      expect.objectContaining({
        path,
        severity: "error",
        message: expect.stringContaining("251 characters; maximum is 250"),
      }),
    );
    expect(JSON.parse(lint.stdout)).not.toHaveProperty("contentHashes");
    const catalog = await runMemory(["catalog", "show", "--json"], env);
    expect(catalog.status).toBe(0);
    expect(JSON.parse(catalog.stdout).entries[0].description).toBe(overlong);
    expect((await runMemory(["lock", "acquire"], env)).status).toBe(0);
    const commit = await runMemory(
      ["commit", "--message", "Validate description", "--source", "session:test", "--memory-id", path],
      env,
    );
    expect(commit.status).toBe(1);
    expect(commit.stderr).toContain("Memory lint failed");
    expect(commit.stderr).toContain("Rewrite it as a");
    expect(await readFile(join(tempDir, "memory", path), "utf-8")).toContain(overlong);
  });

  it("defaults to one auto-created repo per server/session space when no root override is set", async () => {
    const scopedEnv = {
      HOME: tempDir,
      COMPANION_SERVER_ID: "server-id",
      COMPANION_SERVER_SLUG: "server-slug",
      COMPANION_PORT: await serverPort("server-slug"),
      COMPANION_MEMORY_DIR: "",
    };

    const path = await runMemory(["repo", "path"], scopedEnv);
    expect(path.status).toBe(0);
    const expectedRoot = join(tempDir, ".companion", "memory", "server-slug", "Takode");
    expect(path.stdout.trim()).toBe(expectedRoot);

    const catalog = await runMemory(["catalog", "--json"], scopedEnv);
    expect(catalog.status).toBe(0);
    expect(JSON.parse(catalog.stdout).repo).toEqual(
      expect.objectContaining({
        root: expectedRoot,
        serverId: "server-id",
        serverSlug: "server-slug",
        sessionSpaceSlug: "Takode",
        initialized: true,
      }),
    );
    await expect(readFile(join(expectedRoot, ".git", "HEAD"), "utf-8")).resolves.toContain("ref:");
  });

  it("accepts global repo options before or after the command", async () => {
    const scopedEnv = {
      HOME: tempDir,
      COMPANION_SERVER_ID: "server-id",
      COMPANION_SERVER_SLUG: "default",
      COMPANION_PORT: "",
    };

    // This locks down the compaction-recovery-friendly form shown in help.
    const preCommand = await runMemory(["--server-slug", "dev", "--session-space", "Other", "repo", "path"], scopedEnv);
    expect(preCommand.status).toBe(0);

    // This preserves the original post-command placement that already worked.
    const postCommand = await runMemory(
      ["repo", "path", "--server-slug", "dev", "--session-space", "Other"],
      scopedEnv,
    );
    expect(postCommand.status).toBe(0);

    const expectedRoot = join(tempDir, ".companion", "memory", "dev", "Other");
    expect(preCommand.stdout.trim()).toBe(expectedRoot);
    expect(postCommand.stdout.trim()).toBe(expectedRoot);
  });

  it("does not move or catalog another session space when the default space changes", async () => {
    const scopedEnv = {
      HOME: tempDir,
      COMPANION_SERVER_ID: "same-server",
      COMPANION_SERVER_SLUG: "prod",
      COMPANION_PORT: await serverPort("prod"),
      COMPANION_MEMORY_DIR: "",
    };
    const takodeRoot = join(tempDir, ".companion", "memory", "prod", "Takode");
    const otherRoot = join(tempDir, ".companion", "memory", "prod", "Other");

    const first = await runMemory(["catalog", "--json"], { ...scopedEnv, COMPANION_MEMORY_SPACE_SLUG: "Takode" });
    expect(first.status).toBe(0);
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

    const other = await runMemory(["catalog", "--json"], { ...scopedEnv, COMPANION_MEMORY_SPACE_SLUG: "Other" });

    expect(other.status).toBe(0);
    const otherJson = JSON.parse(other.stdout);
    expect(otherJson.repo).toEqual(
      expect.objectContaining({ root: otherRoot, sessionSpaceSlug: "Other", serverId: "same-server" }),
    );
    expect(otherJson.entries).toEqual([]);
    await expect(readFile(join(takodeRoot, "current", "takode.md"), "utf-8")).resolves.toContain("Takode-owned memory");
    await expect(readFile(join(otherRoot, "current", "takode.md"), "utf-8")).rejects.toThrow();
  });

  it("lints authored files and exits non-zero for schema errors", async () => {
    await mkdir(join(tempDir, "memory", "knowledge"), { recursive: true });
    await writeFile(join(tempDir, "memory", "knowledge", "broken.md"), "# no frontmatter\n", "utf-8");

    const result = await runMemory(["lint", "--json"], env);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must start with YAML frontmatter") }),
    );
  });

  it("reports obsolete frontmatter fields from the old schema", async () => {
    await writeMemoryFile(
      "knowledge/old-schema.md",
      `
id: old-schema
kind: knowledge
title: Old Schema
summary: Old summary.
lifecycle: active
canonicalFor:
  - old-memory-schema
source: [q-1220]
`,
    );

    const result = await runMemory(["lint", "--json"], env);

    expect(result.status).toBe(1);
    const issues = JSON.parse(result.stdout).issues as Array<{ severity: string; message: string }>;
    const messages = issues.map((issue) => issue.message);
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        message: 'Obsolete memory frontmatter field "id" is ignored; derive it from path or use description/source.',
      }),
    );
    expect(messages).toContain(
      'Obsolete memory frontmatter field "kind" is ignored; derive it from path or use description/source.',
    );
    expect(messages).toContain(
      'Obsolete memory frontmatter field "title" is ignored; derive it from path or use description/source.',
    );
    expect(messages).toContain(
      'Obsolete memory frontmatter field "summary" is ignored; derive it from path or use description/source.',
    );
    expect(messages).toContain(
      'Obsolete memory frontmatter field "lifecycle" is ignored; derive it from path or use description/source.',
    );
    expect(messages).toContain(
      'Obsolete memory frontmatter field "canonicalFor" is ignored; derive it from path or use description/source.',
    );
    expect(messages).toContain("Memory description is required");
  });

  it("catalogs dual-schema files from path-derived and simplified fields", async () => {
    await writeMemoryFile(
      "knowledge/dual-schema.md",
      `
id: old-id
kind: current
title: Old Title
summary: Old summary.
lifecycle: active
description: New description wins.
source:
  - q-1220
`,
    );

    const catalog = await runMemory(["catalog", "--json"], env);

    expect(catalog.status).toBe(0);
    const parsed = JSON.parse(catalog.stdout);
    expect(parsed.entries[0]).toEqual(
      expect.objectContaining({
        id: "knowledge/dual-schema.md",
        type: "knowledge",
        description: "New description wins.",
        source: ["q-1220"],
      }),
    );
    expect(parsed.entries[0]).not.toHaveProperty("title");
    expect(parsed.entries[0]).not.toHaveProperty("lifecycle");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        message: 'Obsolete memory frontmatter field "kind" is ignored; derive it from path or use description/source.',
      }),
    );
  });

  it("keeps obsolete-field compatibility warnings out of normal catalog output", async () => {
    await writeMemoryFile(
      "knowledge/dual-schema.md",
      `
id: old-id
kind: current
title: Old Title
summary: Old summary.
lifecycle: active
canonicalFor:
  - old-memory-schema
description: New schema description stays visible.
source:
  - q-1220
`,
    );

    const catalog = await runMemory(["catalog"], env);
    expect(catalog.status).toBe(0);
    expect(catalog.stdout).toContain("knowledge/dual-schema.md: New schema description stays visible.");
    expect(catalog.stdout).not.toContain("[knowledge]");
    expect(catalog.stdout).not.toContain("source: q-1220");
    expect(catalog.stdout).not.toContain("Obsolete memory frontmatter field");
    expect(catalog.stdout).not.toContain("Issues:");

    const lint = await runMemory(["lint"], env);
    expect(lint.status).toBe(0);
    expect(lint.stdout).toContain("Obsolete memory frontmatter field");
    // 6 obsolete fields, plus the non-routing description and the legacy type folder.
    expect(lint.stdout).toContain("Memory lint found 0 errors and 8 warnings.");
  });

  it("requires source refs as a YAML list in simplified frontmatter", async () => {
    await writeMemoryFile(
      "references/missing-source.md",
      `
description: Tracks an external source without provenance.
`,
    );
    await writeMemoryFile(
      "references/scalar-source.md",
      `
description: Tracks an external source with scalar provenance.
source: q-1220
`,
    );

    const result = await runMemory(["lint", "--json"], env);

    expect(result.status).toBe(1);
    const issues = JSON.parse(result.stdout).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({ message: "Memory source must list at least one contributing quest or session ref" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ message: "Memory source must be a YAML list of contributing quest or session refs" }),
    );
  });

  it("supports repo-level lock and commit helpers for direct edits", async () => {
    await writeMemoryFile(
      "current/memory-foundation.md",
      `
description: Tracks the active memory implementation state.
source:
  - q-1205
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
        "current/memory-foundation.md",
        "--source",
        "q-1205",
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
    await writeMemoryFile(
      "current/provenance.md",
      `
description: Tracks memory commit provenance validation.
source:
  - q-1205
`,
    );

    const noLock = await runMemory(
      ["commit", "--message", "Missing lock", "--memory-id", "current/provenance.md", "--source", "q-1205"],
      env,
    );
    expect(noLock.status).toBe(1);
    expect(noLock.stderr).toContain("Acquire the memory repo lock");

    await runMemory(["lock", "acquire", "--owner", "worker"], env);

    const missingSource = await runMemory(["commit", "--message", "Missing source", "--memory-id", "provenance"], env);
    expect(missingSource.status).toBe(1);
    expect(missingSource.stderr).toContain("at least one source trailer");

    const missingTraceability = await runMemory(
      ["commit", "--message", "Missing traceability", "--source", "q-1205"],
      env,
    );
    expect(missingTraceability.status).toBe(1);
    expect(missingTraceability.stderr).toContain("include quest, session, or at least one memory id");
  });

  it("treats old workstream/upsert/check commands as unknown and omits migration guidance", async () => {
    // `recall` was retired with the topic-folder catalog; it is now an unknown command too.
    const recall = await runMemory(["recall", "anything"], env);
    expect(recall.status).toBe(1);
    expect(recall.stderr).toContain("Unknown memory command: recall");

    const result = await runMemory(["upsert", "current", "takode/key"], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown memory command: upsert");
    expect(result.stderr).not.toContain("workstream-memory");
    expect(result.stdout).not.toContain("migrate");
    expect(result.stdout).not.toContain("workstream");
    expect(result.stdout).not.toContain("upsert");
    expect(result.stdout).not.toMatch(/^  check\b/m);
  });

  it("chains memory handles across catalog reads, marks notes helpful, and moves notes by plan", async () => {
    await writeMemoryFile("voice/recent.md", 'description: "Read when recent."\ntype: decision\nsource: [q-1]');
    await writeMemoryFile("voice/evidence.md", 'description: "Read for evidence."\ntype: artifact\nsource: [q-1]');
    const handleOf = (output: string) => /memory handle: (mem-[0-9a-f]{10})/.exec(output)?.[1];

    // The overview shows the recent decision; the folder listing under that handle omits it.
    const overview = await runMemory(["catalog", "show"], env);
    expect(overview.status).toBe(0);
    expect(overview.stdout).toContain("voice/recent.md: Read when recent.");
    const listing = await runMemory(["catalog", "show", "voice", "--seen", handleOf(overview.stdout)!], env);
    expect(listing.stdout).toContain("voice/evidence.md: Read for evidence.");
    expect(listing.stdout).not.toContain("voice/recent.md");
    expect(listing.stdout).toContain("1 entry omitted as already shown");
    // Without --seen the listing is complete.
    expect((await runMemory(["catalog", "show", "voice"], env)).stdout).toContain("voice/recent.md");

    expect((await runMemory(["helpful", "voice/evidence.md"], env)).status).toBe(0);
    expect((await runMemory(["helpful", "voice/missing.md"], env)).status).toBe(1);

    const planPath = join(tempDir, "plan.txt");
    await writeFile(planPath, "voice/evidence.md audio/evidence.md\n", "utf-8");
    expect((await runMemory(["mv", "--plan", planPath], env)).status).toBe(1); // Needs the lock.
    expect((await runMemory(["lock", "acquire"], env)).status).toBe(0);
    const moved = await runMemory(["mv", "--plan", planPath], env);
    expect(moved.status).toBe(0);
    expect(moved.stdout).toContain("Moved 1 note(s)");
    const json = JSON.parse((await runMemory(["catalog", "show", "--json"], env)).stdout);
    expect(json.entries.map((entry: { path: string }) => entry.path)).toContain("audio/evidence.md");
  });

  it("prints self-contained help without re-advertising legacy commands", async () => {
    const help = await runMemory(["help"], env);

    expect(help.status).toBe(0);
    // The help text should be enough for an agent to recover the command surface after compaction.
    expect(help.stdout).toContain("~/.companion/memory/<serverSlug>/<sessionSpace>");
    expect(help.stdout).toContain("repo path");
    expect(help.stdout).toContain("catalog show <folder> [--seen HANDLE]");
    expect(help.stdout).toContain("catalog diff [--seen HANDLE]");
    expect(help.stdout).toContain("helpful <path>...");
    expect(help.stdout).toContain("mv <old-path> <new-path> | mv --plan <file>");
    expect(help.stdout).toContain("--operation update|repair");
    expect(help.stdout).toContain("Load the `memory` skill");
    expect(help.stdout).toContain("source: [q-N]");
    expect(help.stdout).toContain("memory lock acquire --owner <session-or-role>");
    expect(help.stdout).toContain("memory commit --message");
    expect(help.stdout).not.toContain('memory recall "current task terms"');
    expect(help.stdout).not.toContain("recall [query]");
    expect(help.stdout).not.toContain("repo path [--json]");
    expect(help.stdout).not.toContain("doctor");
    expect(help.stdout).not.toContain("repo path|init");
    expect(help.stdout).not.toContain("repo init");
    expect(help.stdout).not.toContain("migrate");
    expect(help.stdout).not.toContain("workstream");
    expect(help.stdout).not.toContain("upsert");
    expect(help.stdout).not.toMatch(/^  check\b/m);
  });

  // The server is the only writer of memory data. Without it, writes (including catalog reads,
  // which record freshness and handles) fail clearly, while plain reads still work locally and
  // never create, migrate or index a repo.
  it("runs writes on the server and keeps local reads from creating a repo", async () => {
    const [server] = servers.splice(0);
    await server!.stop();
    const root = join(tempDir, "memory");

    const lock = await runMemory(["lock", "acquire", "--owner", "worker"], env);
    expect(lock.status).toBe(1);
    expect(lock.stderr).toContain(`Cannot reach the Takode server at http://localhost:${env.COMPANION_PORT}`);
    const catalog = await runMemory(["catalog", "show"], env);
    expect(catalog.status).toBe(1);
    expect(catalog.stderr).toContain("Memory changes are written by the server");
    const noServer = await runMemory(["helpful", "voice/a.md"], { ...env, COMPANION_PORT: "" });
    expect(noServer.status).toBe(1);
    expect(noServer.stderr).toContain("No Takode server is configured for this command");

    for (const args of [["repo", "path"], ["lint"], ["status"], ["diff"], ["lock", "status"]]) {
      const result = await runMemory(args, env);
      expect({ args, status: result.status, stderr: result.stderr }).toEqual({ args, status: 0, stderr: "" });
    }
    await expect(readFile(join(root, ".git", "HEAD"), "utf-8")).rejects.toThrow();
  });

  it("records the authenticated caller session on locks the server takes", async () => {
    const lock = await runMemory(["lock", "acquire", "--owner", "worker", "--json"], {
      ...env,
      COMPANION_SESSION_ID: "session-a",
      COMPANION_AUTH_TOKEN: "token-a",
    });
    expect(lock.status).toBe(0);
    expect(JSON.parse(lock.stdout)).toMatchObject({ locked: true, owner: "worker", session: "session-a" });
  });
});
