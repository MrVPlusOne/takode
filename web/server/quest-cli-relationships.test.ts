import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function runQuest(
  args: string[],
  home: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...process.env,
      HOME: home,
      COMPANION_PORT: undefined,
      COMPANION_SESSION_ID: undefined,
      BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun/install/cache"),
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

describe("quest CLI relationships", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "quest-cli-relationships-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("writes explicit follow-up links and shows derived backlinks", async () => {
    // Exercises the user-facing CLI contract: write with --follow-up-of, inspect forward/reverse links via show.
    expect((await runQuest(["create", "Original"], home)).status).toBe(0);
    expect((await runQuest(["create", "Follow-up", "--follow-up-of", "q-1"], home)).status).toBe(0);

    const original = await runQuest(["show", "q-1"], home);
    const followUp = await runQuest(["show", "q-2", "--json"], home);

    expect(original.stdout).toContain("Relationships:");
    expect(original.stdout).toContain("Has follow-up: q-2 (explicit)");
    expect(JSON.parse(followUp.stdout)).toMatchObject({
      relationships: { followUpOf: ["q-1"] },
      relatedQuests: [{ questId: "q-1", kind: "follow_up_of", explicit: true }],
    });
  });

  it("clears explicit follow-up links and removes derived reverse relationships", async () => {
    // Regression coverage for review feedback: clearing must be an intentional public CLI syntax, not an empty-value accident.
    expect((await runQuest(["create", "Original"], home)).status).toBe(0);
    expect((await runQuest(["create", "Follow-up", "--follow-up-of", "q-1"], home)).status).toBe(0);

    const relatedSearch = await runQuest(["list", "--text", "has_follow_up", "--json"], home);
    expect(JSON.parse(relatedSearch.stdout).map((quest: { questId: string }) => quest.questId)).toEqual(["q-1"]);

    const clear = await runQuest(["edit", "q-2", "--clear-follow-up-of"], home);
    expect(clear.status).toBe(0);

    const original = JSON.parse((await runQuest(["show", "q-1", "--json"], home)).stdout);
    const followUp = JSON.parse((await runQuest(["show", "q-2", "--json"], home)).stdout);
    const clearedSearch = await runQuest(["list", "--text", "has_follow_up", "--json"], home);

    expect(followUp.relationships).toBeUndefined();
    expect(followUp.relatedQuests).toBeUndefined();
    expect(original.relatedQuests).toBeUndefined();
    expect(JSON.parse(clearedSearch.stdout)).toEqual([]);
  });
});
