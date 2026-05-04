import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function runStream(
  args: string[],
  env: Record<string, string | undefined>,
  stdinText?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const streamPath = fileURLToPath(new URL("../bin/stream.ts", import.meta.url));
  const child = spawn(process.execPath, [streamPath, ...args], {
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR:
        env.BUN_INSTALL_CACHE_DIR ||
        process.env.BUN_INSTALL_CACHE_DIR ||
        join(process.env.HOME || "", ".bun/install/cache"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  if (stdinText !== undefined) child.stdin?.write(stdinText);
  child.stdin?.end();
  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

describe("stream CLI", () => {
  let home: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "stream-cli-"));
    env = {
      ...process.env,
      HOME: home,
      COMPANION_SERVER_ID: "server-test",
      COMPANION_SESSION_ID: "session-test",
    };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function scopeFile(scope: string): string {
    const digest = createHash("sha1").update(scope).digest("hex").slice(0, 16);
    return join(home, ".companion", "streams", `${digest}.json`);
  }

  it("creates, updates, shows, searches, and archives a stream", async () => {
    const create = await runStream(
      [
        "create",
        "AI judging",
        "--summary",
        "4-lane monitor active",
        "--tags",
        "ml,judging",
        "--quest",
        "q-645",
        "--owner",
        "993",
        "--steering-mode",
        "leader-steered",
        "--pin",
        "canonical output root: /mnt/vast/judged",
        "--json",
      ],
      env,
    );
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout) as { slug: string; current: { summary: string } };
    expect(created.slug).toBe("ai-judging");
    expect(created.current.summary).toBe("4-lane monitor active");

    const update = await runStream(
      [
        "update",
        "ai-judging",
        "--type",
        "contradiction",
        "--entry-file",
        "-",
        "--state",
        "Client and inference pool reports reconciled",
        "--source",
        "session:989:3077",
        "--session",
        "989",
        "--worker",
        "986",
        "--health",
        "healthy",
      ],
      env,
      "Client saw 0 healthy backends while inference worker verified 8/8 healthy.",
    );
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("Updated stream");

    const show = await runStream(["show", "ai-judging"], env);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain("Current State:");
    expect(show.stdout).toContain("Client and inference pool reports reconciled");
    expect(show.stdout).toContain("[contradiction]");
    expect(show.stdout).toContain("source: session:989:3077");
    expect(show.stdout).toContain("quest:q-645");

    const search = await runStream(["search", "reconciled"], env);
    expect(search.status).toBe(0);
    expect(search.stdout).toContain("ai-judging");

    const archive = await runStream(["archive", "ai-judging", "--reason", "done"], env);
    expect(archive.status).toBe(0);
    const list = await runStream(["list"], env);
    expect(list.stdout).toContain("No streams found.");
    const archived = await runStream(["list", "--archived"], env);
    expect(archived.stdout).toContain("ai-judging (archived)");
  });

  it("prints a compact handoff for reviewer usability checks", async () => {
    await runStream(["create", "Nebius salvage", "--summary", "Canonical artifact repaired", "--owner", "1014"], env);
    await runStream(
      [
        "update",
        "nebius-salvage",
        "--type",
        "artifact",
        "--entry",
        "Repaired canonical artifact promoted",
        "--artifact",
        "/mnt/vast/data/nebius_swe_rebench.lance",
        "--operational-status",
        "done",
      ],
      env,
    );

    const handoff = await runStream(["handoff", "nebius-salvage"], env);
    expect(handoff.status).toBe(0);
    expect(handoff.stdout).toContain("Handoff for");
    expect(handoff.stdout).toContain("Canonical artifact repaired");
    expect(handoff.stdout).toContain("Operational status: done");
    expect(handoff.stdout).toContain("Owners: 1014");
  });

  it("rejects invalid confidence values before persisting an update", async () => {
    await runStream(["create", "Confidence check", "--summary", "active"], env);

    const update = await runStream(
      ["update", "confidence-check", "--entry", "Bad confidence", "--confidence", "maybe"],
      env,
    );

    expect(update.status).toBe(1);
    expect(update.stderr).toContain("--confidence must be one of");
  });

  it("fails on corrupt scope files without replacing the existing file", async () => {
    const scope = "server-test:explicit-corrupt";
    const create = await runStream(["create", "Corrupt CLI", "--scope", scope, "--summary", "preserved"], env);
    expect(create.status).toBe(0);
    const file = scopeFile(scope);
    writeFileSync(file, "{broken", "utf-8");

    const secondCreate = await runStream(["create", "Should not overwrite", "--scope", scope], env);
    expect(secondCreate.status).toBe(1);
    expect(secondCreate.stderr).toContain("Failed to load stream scope");
    expect(readFileSync(file, "utf-8")).toBe("{broken");
  });
});
