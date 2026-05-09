import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSessionAuthDir, getSessionAuthPath } from "../shared/session-auth.js";

type JsonObject = Record<string, unknown>;

function centralAuthPath(cwd: string, home?: string, serverId = "test-server-id"): string {
  return getSessionAuthPath(cwd, serverId, home);
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

describe("quest CLI status safety", () => {
  it("documents create-refined and status override flags", async () => {
    const result = await runQuest(["--help"], { ...process.env });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("quest create --title-file title.txt --desc-file body.md --status refined");
    expect(result.stdout).toContain("complete <id>");
    expect(result.stdout).toContain("[--force --reason <text>]");
    expect(result.stdout).toContain("transition <id> --status <s>");
  });

  it("creates a refined quest directly with --status refined", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-create-status-refined-"));

    try {
      const result = await runQuest(
        ["create", "Ready quest", "--desc", "Approved scope", "--status", "refined"],
        {
          ...process.env,
          COMPANION_PORT: undefined,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain('Created q-1: "Ready quest" (refined)');
      expect(result.stdout).toContain("Use this exact quest ID for follow-up commands: q-1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("sends transition force reasons to the status endpoint", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-transition-force-http-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/transition") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "done", description: "Ready" }));
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
          "transition",
          "q-1",
          "--status",
          "done",
          "--desc",
          "Ready",
          "--force",
          "--reason",
          "leader approved recovery",
          "--json",
        ],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        status: "done",
        description: "Ready",
        sessionId: "session-file",
        force: true,
        reason: "leader approved recovery",
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
