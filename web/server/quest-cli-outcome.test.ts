import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR:
        env.BUN_INSTALL_CACHE_DIR ||
        process.env.BUN_INSTALL_CACHE_DIR ||
        join(process.env.HOME || "", ".bun/install/cache"),
    },
    cwd,
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

function baseEnv(home: string): Record<string, string | undefined> {
  return {
    ...process.env,
    COMPANION_PORT: undefined,
    COMPANION_SESSION_ID: undefined,
    COMPANION_AUTH_TOKEN: undefined,
    HOME: home,
  };
}

function seedLiveQuest(home: string, quest: JsonObject): void {
  const liveDir = join(home, ".companion", "questmaster-live");
  mkdirSync(liveDir, { recursive: true });
  writeFileSync(
    join(liveDir, "store.json"),
    JSON.stringify(
      {
        format: "mutable_current_record",
        version: 1,
        nextQuestNumber: 100,
        updatedAt: 1,
        quests: [quest],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function baseQuest(outcome: unknown): JsonObject {
  return {
    id: "q-7",
    questId: "q-7",
    version: 1,
    title: "Preserve legacy outcome",
    description: "Exercise read-only legacy recovery.",
    status: "in_progress",
    sessionId: "worker-7",
    claimedAt: 1,
    createdAt: 1,
    statusChangedAt: 1,
    outcome,
  };
}

describe("quest outcome CLI legacy compatibility", () => {
  it("shows opaque legacy Outcome data locally without assuming a revision schema", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-legacy-outcome-show-"));
    const outcome = {
      futureSchema: 7,
      arbitrary: { nested: ["human-authored", { retained: true }] },
    };
    seedLiveQuest(tmp, baseQuest(outcome));

    try {
      const plain = await runQuest(["outcome", "show", "q-7"], baseEnv(tmp), tmp);
      const json = await runQuest(["outcome", "show", "q-7", "--json"], baseEnv(tmp), tmp);

      expect(plain.status).toBe(0);
      expect(plain.stderr).toBe("");
      expect(plain.stdout).toContain("preserved legacy Quest Outcome data (read-only)");
      expect(plain.stdout).toContain('"futureSchema": 7');
      expect(JSON.parse(json.stdout)).toEqual({ questId: "q-7", legacy: true, present: true, outcome });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
