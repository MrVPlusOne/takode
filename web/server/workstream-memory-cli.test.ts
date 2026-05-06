import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
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
    env = { COMPANION_WORKSTREAM_MEMORY_DIR: join(tempDir, "memory") };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates, links, upserts, reads, searches, and retires memory records", async () => {
    const created = await runMemory(
      [
        "workstream",
        "create",
        "--slug",
        "takode-memory",
        "--title",
        "Takode memory",
        "--objective",
        "Preserve workstream memory.",
        "--scope-tags",
        "takode,memory",
        "--source",
        "[q-100](quest:q-100)",
        "--json",
      ],
      env,
    );
    expect(created.status).toBe(0);
    expect(JSON.parse(created.stdout).workstream.slug).toBe("takode-memory");

    const linked = await runMemory(["workstream", "link", "takode-memory", "--quest", "q-101", "--json"], env);
    expect(linked.status).toBe(0);
    expect(JSON.parse(linked.stdout).workstream.linkedQuests[0].questId).toBe("q-101");

    const upserted = await runMemory(
      [
        "upsert",
        "current",
        "takode-memory/current-model",
        "--subtype",
        "decision",
        "--priority",
        "blocking",
        "--current",
        "Use Current Context and Reference Pointer buckets.",
        "--applies-to",
        "quest:q-101",
        "--retrieval-hooks",
        "alignment",
        "--source",
        "[q-100](quest:q-100)",
        "--authority-boundary",
        "memory owns accepted memory model|quest|user-overrides",
        "--json",
      ],
      env,
    );
    expect(upserted.status).toBe(0);
    expect(JSON.parse(upserted.stdout).record.key).toBe("current-model");

    const currentRead = await runMemory(["current", "read", "--quest", "q-101", "--for", "alignment", "--json"], env);
    expect(currentRead.status).toBe(0);
    expect(JSON.parse(currentRead.stdout).records[0].current).toContain("Reference Pointer");

    const grep = await runMemory(["grep", "Reference Pointer", "--json"], env);
    expect(grep.status).toBe(0);
    expect(JSON.parse(grep.stdout).results[0].record.key).toBe("current-model");

    const retired = await runMemory(
      [
        "retire",
        "takode-memory/current-model",
        "--reason",
        "Superseded by next design.",
        "--source",
        "[q-101](quest:q-101)",
        "--json",
      ],
      env,
    );
    expect(retired.status).toBe(0);
    expect(JSON.parse(retired.stdout).record.status).toBe("retired");

    const hidden = await runMemory(["grep", "Reference Pointer", "--json"], env);
    expect(hidden.status).toBe(0);
    expect(JSON.parse(hidden.stdout).results).toEqual([]);
  });

  it("fails validation without user-facing memory check commands", async () => {
    const result = await runMemory(["check", "--event", "dispatch"], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: check");
  });
});
