import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  async function writeJson(name: string, value: unknown): Promise<string> {
    const path = join(tempDir, name);
    await writeFile(path, JSON.stringify(value), "utf-8");
    return path;
  }

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

    const check = await runMemory(["check", "--event", "dispatch", "--quest", "q-101", "--json"], env);
    expect(check.status).toBe(0);
    expect(JSON.parse(check.stdout).findings).toContainEqual(
      expect.objectContaining({ level: "recall", record: "takode-memory/current-model" }),
    );

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

    const report = await runMemory(["bookkeeping", "report", "--workstream", "takode-memory", "--json"], env);
    expect(report.status).toBe(0);
    expect(JSON.parse(report.stdout).report.issues).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/current-model",
        message: expect.stringContaining("hidden retired record retained"),
      }),
    );

    const hidden = await runMemory(["grep", "Reference Pointer", "--json"], env);
    expect(hidden.status).toBe(0);
    expect(JSON.parse(hidden.stdout).results).toEqual([]);
  });

  it("fails validation for unsupported memory check events", async () => {
    const result = await runMemory(["check", "--event", "board-watchdog"], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--event must be one of");
  });

  it("classifies active-run check JSON using product proof source and trust", async () => {
    await runMemory(
      [
        "workstream",
        "create",
        "--slug",
        "takode-memory",
        "--title",
        "Takode memory",
        "--objective",
        "Preserve workstream memory.",
        "--source",
        "[q-100](quest:q-100)",
      ],
      env,
    );
    await runMemory(["workstream", "link", "takode-memory", "--quest", "q-101"], env);

    const activeRunFile = await writeJson("active-run.json", {
      linkedQuestId: "q-101",
      expectedRunState: "active-obligation",
      monitorRequirement: {
        cadenceMinutes: 15,
        requiredProductProof: "timer-or-hard-event",
        stopConditionRequiresLeaderAction: true,
      },
      stopConditions: ["tmux-missing"],
    });

    const upserted = await runMemory(
      [
        "upsert",
        "current",
        "takode-memory/active-run",
        "--subtype",
        "active-run",
        "--priority",
        "safety",
        "--current",
        "q-101 must keep a trusted monitor proof before handoff.",
        "--applies-to",
        "quest:q-101",
        "--retrieval-hooks",
        "execute-launch,worker-turn-end",
        "--source",
        "[q-100](quest:q-100)",
        "--authority-boundary",
        "expected active-run obligations|timer-store|product-state-overrides",
        "--retire-when",
        "q-101 run completes, stops, or is replaced",
        "--active-run-file",
        activeRunFile,
        "--json",
      ],
      env,
    );
    expect(upserted.status).toBe(0);

    const executeStateFile = await writeJson("execute-state.json", {
      kind: "execute-launch",
      questId: "q-101",
      longRunning: true,
    });
    const callerSuppliedProofFile = await writeJson("caller-proof.json", {
      source: "caller-supplied",
      trusted: true,
      proofs: [{ kind: "timer", trusted: true }],
    });

    const callerSupplied = await runMemory(
      [
        "check",
        "--event",
        "execute-launch",
        "--quest",
        "q-101",
        "--state-file",
        executeStateFile,
        "--product-state-file",
        callerSuppliedProofFile,
        "--enforce",
        "--json",
      ],
      env,
    );
    const callerSuppliedResult = JSON.parse(callerSupplied.stdout);
    expect(callerSupplied.status).toBe(0);
    expect(callerSuppliedResult.level).toBe("gate");
    expect(callerSuppliedResult.enforceable).toBe(false);

    const untrustedProofFile = await writeJson("untrusted-proof.json", {
      source: "product-adapter",
      trusted: true,
      proofs: [{ kind: "timer", trusted: false }],
    });
    const untrustedProof = await runMemory(
      [
        "check",
        "--event",
        "execute-launch",
        "--quest",
        "q-101",
        "--state-file",
        executeStateFile,
        "--product-state-file",
        untrustedProofFile,
        "--enforce",
        "--json",
      ],
      env,
    );
    const untrustedResult = JSON.parse(untrustedProof.stdout);
    expect(untrustedProof.status).toBe(0);
    expect(untrustedResult.level).toBe("gate");
    expect(untrustedResult.enforceable).toBe(true);

    const workerTurnEndFile = await writeJson("worker-turn-end.json", {
      kind: "worker-turn-end",
      questId: "q-101",
      summarySignals: ["tmux-missing"],
      reportedToUser: false,
    });
    const trustedAdapterFile = await writeJson("trusted-adapter.json", {
      source: "product-adapter",
      trusted: true,
    });
    const stopCondition = await runMemory(
      [
        "check",
        "--event",
        "worker-turn-end",
        "--quest",
        "q-101",
        "--state-file",
        workerTurnEndFile,
        "--product-state-file",
        trustedAdapterFile,
        "--enforce",
        "--json",
      ],
      env,
    );
    const stopConditionResult = JSON.parse(stopCondition.stdout);
    expect(stopCondition.status).toBe(0);
    expect(stopConditionResult.level).toBe("gate");
    expect(stopConditionResult.findings).toContainEqual(
      expect.objectContaining({ why: expect.arrayContaining([expect.stringContaining("tmux-missing")]) }),
    );
  });

  it("surfaces bookkeeping cleanup candidates through check JSON", async () => {
    await runMemory(
      [
        "workstream",
        "create",
        "--slug",
        "takode-memory",
        "--title",
        "Takode memory",
        "--objective",
        "Preserve workstream memory.",
        "--source",
        "[q-100](quest:q-100)",
      ],
      env,
    );
    await runMemory(
      [
        "upsert",
        "current",
        "takode-memory/active-route",
        "--subtype",
        "route",
        "--priority",
        "important",
        "--current",
        "Use the temporary route until the foundation is accepted.",
        "--applies-to",
        "term:route",
        "--source",
        "[q-100](quest:q-100)",
        "--authority-boundary",
        "memory owns current route|quest|user-overrides",
        "--retire-when",
        "foundation is accepted or replaced",
      ],
      env,
    );
    await runMemory(
      [
        "upsert",
        "current",
        "takode-memory/retired-note",
        "--subtype",
        "decision",
        "--priority",
        "important",
        "--current",
        "Retire this record after it is no longer current.",
        "--applies-to",
        "term:retired-note",
        "--source",
        "[q-100](quest:q-100)",
        "--authority-boundary",
        "memory owns current note|quest|user-overrides",
      ],
      env,
    );
    await runMemory(
      [
        "upsert",
        "current",
        "takode-memory/superseded-note",
        "--subtype",
        "decision",
        "--priority",
        "important",
        "--current",
        "Supersede this record after replacement.",
        "--applies-to",
        "term:superseded-note",
        "--source",
        "[q-100](quest:q-100)",
        "--authority-boundary",
        "memory owns current note|quest|user-overrides",
      ],
      env,
    );
    await runMemory(
      ["retire", "takode-memory/retired-note", "--reason", "No longer current.", "--source", "[q-100](quest:q-100)"],
      env,
    );
    await runMemory(
      [
        "retire",
        "takode-memory/superseded-note",
        "--reason",
        "Replaced by a newer decision.",
        "--source",
        "[q-100](quest:q-100)",
        "--superseded-by",
        "takode-memory/newer-note",
      ],
      env,
    );

    const check = await runMemory(["check", "--event", "bookkeeping", "--workstream", "takode-memory", "--json"], env);
    const result = JSON.parse(check.stdout);

    expect(check.status).toBe(0);
    expect(result.level).toBe("warn");
    expect(result.enforceable).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/active-route",
        why: expect.arrayContaining([expect.stringContaining("retireWhen cleanup review candidate")]),
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/retired-note",
        why: expect.arrayContaining([expect.stringContaining("hidden retired record retained")]),
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/superseded-note",
        why: expect.arrayContaining([expect.stringContaining("hidden superseded record replaced")]),
      }),
    );
  });
});
