import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCliWriteServer, type CliWriteServer } from "./test-fixtures/cli-write-server-harness.js";

async function runQuest(
  args: string[],
  home: string,
  port: number,
): Promise<{ status: number | null; stdout: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...process.env,
      HOME: home,
      COMPANION_PORT: String(port),
      COMPANION_SESSION_ID: undefined,
      BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun/install/cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const [code] = await once(child, "close");
  return { status: code as number | null, stdout };
}

// A session on another machine runs the quest CLI over a HOME with no quest
// store. Whole-store reads must come from the server, not from that empty store.
describe("quest CLI on a machine without the quest store", () => {
  let serverHome: string;
  let hostHome: string;
  let server: CliWriteServer;

  beforeEach(async () => {
    serverHome = await mkdtemp(join(tmpdir(), "quest-cli-server-"));
    hostHome = await mkdtemp(join(tmpdir(), "quest-cli-host-"));
    server = await startCliWriteServer(serverHome);
  });

  afterEach(async () => {
    await server.stop();
    await rm(serverHome, { recursive: true, force: true });
    await rm(hostHome, { recursive: true, force: true });
  });

  it("lists, greps and counts tags through the server", async () => {
    const run = (args: string[]) => runQuest(args, hostHome, server.port);
    expect((await run(["create", "Alpha task", "--tags", "ui,bug"])).status).toBe(0);
    expect((await run(["create", "Beta task", "--tags", "ui"])).status).toBe(0);

    const listed = JSON.parse((await run(["list", "--tags", "bug", "--json"])).stdout);
    expect(listed.map((quest: { questId: string }) => quest.questId)).toEqual(["q-1"]);

    const grep = JSON.parse((await run(["grep", "Beta", "--json"])).stdout);
    expect(grep.matches.map((match: { questId: string }) => match.questId)).toEqual(["q-2"]);

    expect(JSON.parse((await run(["tags", "--json"])).stdout)).toEqual({ ui: 2, bug: 1 });
  });
});
