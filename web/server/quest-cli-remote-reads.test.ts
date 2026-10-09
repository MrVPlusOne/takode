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
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...process.env,
      HOME: home,
      COMPANION_PORT: String(port),
      COMPANION_SESSION_ID: undefined,
      TAKODE_REMOTE_HOST: undefined,
      BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun/install/cache"),
      ...extraEnv,
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

  // A server that answers is authoritative: when it has no such quest, the CLI
  // reports that instead of showing a same-numbered quest from a store that
  // happens to exist on this machine (for example an old copy on a host).
  it("trusts the server's not-found over a local store", async () => {
    expect((await runQuest(["create", "Only in the local store"], serverHome, server.port)).status).toBe(0);
    const emptyHome = await mkdtemp(join(tmpdir(), "quest-cli-empty-server-"));
    const emptyServer = await startCliWriteServer(emptyHome);
    try {
      const shown = await runQuest(["show", "q-1"], serverHome, emptyServer.port);
      expect(shown.status).toBe(1);
      expect(shown.stderr).toContain("Quest q-1 not found");
      expect(shown.stdout).not.toContain("Only in the local store");
    } finally {
      await emptyServer.stop();
      await rm(emptyHome, { recursive: true, force: true });
    }
  });

  // On a remote host the coordinator holds the only quest store. When it cannot
  // be reached, reads fail clearly instead of answering from this machine's files.
  it("never reads a local store on a remote host", async () => {
    expect((await runQuest(["create", "Stale host copy"], serverHome, server.port)).status).toBe(0);
    const port = server.port;
    await server.stop();
    const onHost = { TAKODE_REMOTE_HOST: "1" };

    const shown = await runQuest(["show", "q-1"], serverHome, port, onHost);
    expect(shown.status).toBe(1);
    expect(shown.stderr).toContain("keeps no copy of the quest store");
    expect(shown.stdout).not.toContain("Stale host copy");

    const listed = await runQuest(["list"], serverHome, port, onHost);
    expect(listed.status).toBe(1);
    expect(listed.stdout).not.toContain("Stale host copy");
  });
});
