import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body ? (JSON.parse(body) as JsonObject) : {}));
  });
}

async function runQuest(args: string[], env: Record<string, string | undefined>, cwd: string, stdin?: string) {
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
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (stdin !== undefined) child.stdin?.end(stdin);
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

/**
 * `quest reopen` and `quest round edit` send the new round through the
 * guarded transition route and a round patch, the same server paths the
 * leader's other quest status changes use.
 */
describe("quest rounds CLI", () => {
  it("reopens a quest into a titled round with its brief and requests, and edits a round", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-rounds-"));
    const seen: Array<{ method?: string; url?: string; body: JsonObject }> = [];
    const server = createServer(async (req, res) => {
      const body = await readJson(req);
      seen.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "q-7",
          questId: "q-7",
          version: 3,
          title: "Library",
          status: "refined",
          description: "Standing brief",
          createdAt: 1,
          rounds: [{ openedAt: 1 }, { openedAt: 2, title: "Stars" }],
        }),
      );
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const env = {
        ...process.env,
        COMPANION_PORT: String((server.address() as AddressInfo).port),
        COMPANION_SESSION_ID: undefined,
        COMPANION_AUTH_TOKEN: undefined,
        HOME: tmp,
      };
      const reopened = await runQuest(
        ["reopen", "q-7", "--title", "Stars", "--brief-file", "-", "--requests", "81,#84"],
        env,
        tmp,
        "Add stars to gallery cards.\n",
      );
      expect(reopened.stderr).toBe("");
      expect(reopened.status).toBe(0);
      expect(reopened.stdout).toContain("Reopened q-7 for round 2: Stars");

      const edited = await runQuest(["round", "edit", "q-7", "2", "--title", "Gallery stars"], env, tmp);
      expect(edited.status).toBe(0);
      expect(edited.stdout).toContain("Updated round 2 of q-7");

      const badRequests = await runQuest(["reopen", "q-7", "--title", "X", "--requests", "a"], env, tmp);
      expect(badRequests.status).not.toBe(0);
      expect(badRequests.stderr).toContain("--requests takes feedback indices");

      expect(seen).toEqual([
        {
          method: "POST",
          url: "/api/quests/q-7/transition",
          body: {
            status: "refined",
            openRound: { title: "Stars", brief: "Add stars to gallery cards.\n", requests: [81, 84] },
          },
        },
        { method: "PATCH", url: "/api/quests/q-7", body: { round: { number: 2, title: "Gallery stars" } } },
      ]);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
