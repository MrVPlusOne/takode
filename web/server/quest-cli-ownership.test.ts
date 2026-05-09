import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

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
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env,
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

describe("quest CLI ownership commands", () => {
  it("sends force claim payload with reason to the claim endpoint", async () => {
    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/claim") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", sessionId: "worker-1" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = String((server.address() as AddressInfo).port);

    try {
      const result = await runQuest(["claim", "q-1", "--force", "--reason", "board assigned", "--json"], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-1",
        COMPANION_AUTH_TOKEN: "tok",
        COMPANION_PORT: port,
        TAKODE_ROLE: undefined,
      });

      expect(result.status).toBe(0);
      expect(seenBodies).toEqual([{ sessionId: "worker-1", force: true, reason: "board assigned" }]);
    } finally {
      server.close();
    }
  });

  it("rejects force claim targeting another session before calling the server", async () => {
    const result = await runQuest(["claim", "q-1", "--session", "worker-2", "--force", "--reason", "stale"], {
      ...process.env,
      COMPANION_SESSION_ID: "worker-1",
      COMPANION_AUTH_TOKEN: "tok",
      COMPANION_PORT: "3456",
      TAKODE_ROLE: undefined,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Force claim cannot target another session");
  });

  it("sends leader reassignment payload to the reassign endpoint", async () => {
    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/reassign") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", sessionId: "worker-2" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = String((server.address() as AddressInfo).port);

    try {
      const result = await runQuest(["reassign", "q-1", "--session", "worker-2", "--reason", "stale", "--json"], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "tok",
        COMPANION_PORT: port,
        TAKODE_ROLE: "orchestrator",
      });

      expect(result.status).toBe(0);
      expect(seenBodies).toEqual([{ sessionId: "worker-2", reason: "stale" }]);
    } finally {
      server.close();
    }
  });

  it("documents audited force and reassign commands in help", async () => {
    const result = await runQuest(["--help"], { ...process.env });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("claim  <id> [--session <sid>] [--force --reason <text>] [--json]");
    expect(result.stdout).toContain("reassign <id> --session <worker> --reason <text> [--json]");
  });
});
