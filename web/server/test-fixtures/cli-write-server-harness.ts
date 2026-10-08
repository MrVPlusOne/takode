import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export interface CliWriteServer {
  port: number;
  stop: () => Promise<void>;
}

const SERVER_SCRIPT = fileURLToPath(new URL("./cli-write-server.ts", import.meta.url));

/**
 * Start the real quest/memory write server for CLI tests in its own process,
 * with `home` as its HOME so it only ever touches that disposable directory.
 */
export async function startCliWriteServer(
  home: string,
  options: { leaderIds?: string[]; serverSlug?: string } = {},
): Promise<CliWriteServer> {
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      // Keep Bun's package cache on the real home directory.
      BUN_INSTALL_CACHE_DIR:
        process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun", "install", "cache"),
      TAKODE_TEST_LEADER_IDS: (options.leaderIds ?? []).join(","),
      ...(options.serverSlug ? { TAKODE_TEST_SERVER_SLUG: options.serverSlug } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const port = await readPort(child, () => stderr);
  return {
    port,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await once(child, "exit");
    },
  };
}

async function readPort(child: ChildProcess, stderr: () => string): Promise<number> {
  const lines = createInterface({ input: child.stdout! });
  const exited = once(child, "exit").then(() => {
    throw new Error(`CLI write server exited before listening:\n${stderr()}`);
  });
  const listening = (async () => {
    for await (const line of lines) {
      const parsed = JSON.parse(line) as { port?: unknown };
      if (typeof parsed.port === "number") return parsed.port;
    }
    throw new Error(`CLI write server closed its output before listening:\n${stderr()}`);
  })();
  return Promise.race([listening, exited]);
}
