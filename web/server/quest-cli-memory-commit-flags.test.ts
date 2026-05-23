import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getSessionAuthDir, getSessionAuthPath } from "../shared/session-auth.js";

type JsonObject = Record<string, unknown>;

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const childEnv = {
    ...env,
    BUN_INSTALL_CACHE_DIR:
      env.BUN_INSTALL_CACHE_DIR ||
      process.env.BUN_INSTALL_CACHE_DIR ||
      join(process.env.HOME || "", ".bun/install/cache"),
  };
  const child = spawn(process.execPath, [questPath, ...args], {
    env: childEnv,
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

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      resolve(body ? (JSON.parse(body) as JsonObject) : {});
    });
  });
}

describe("quest CLI memory commit metadata flags", () => {
  it("documents memory commit flags separately from code commit flags in help", async () => {
    const result = await runQuest(["--help"], { ...process.env });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[--memory-commit <sha>] [--memory-commits");
    expect(result.stdout).toContain(
      "--commit/--commits                 Attach code repo commit SHAs separately from memory repo commits",
    );
    expect(result.stdout).toContain(
      "--memory-commit/--memory-commits   Attach memory repo commit SHAs separately from code repo commits",
    );
  });

  it("forwards memory commit SHAs separately from code commit SHAs during HTTP completion", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-memory-commits-http-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = getSessionAuthPath(tmp, "test-server-id", tmp);
    const seenBodies: JsonObject[] = [];

    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/complete") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            questId: "q-1",
            title: "Quest",
            status: "done",
            verificationItems: [{ text: "Visual check", checked: false }],
            commitShas: ["abc1234", "deadbeef"],
            memoryCommitShas: ["c0ffee1", "feedbee"],
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/api/quests/_notify") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        [
          "complete",
          "q-1",
          "--items",
          "Visual check",
          "--commit",
          "ABC1234",
          "--commits",
          "deadbeef,abc1234",
          "--memory-commit",
          "c0ffee1",
          "--memory-commits",
          "feedbee,c0ffee1",
        ],
        {
          ...process.env,
          COMPANION_PORT: String(port),
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        verificationItems: [{ text: "Visual check", checked: false }],
        commitShas: ["abc1234", "deadbeef"],
        memoryCommitShas: ["c0ffee1", "feedbee"],
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
