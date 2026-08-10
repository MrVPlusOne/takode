import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

async function runTakode(args: string[], port: number) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    env: {
      ...process.env,
      COMPANION_SESSION_ID: "leader-reconnect",
      COMPANION_AUTH_TOKEN: "auth-reconnect",
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
  const [status] = await once(child, "close");
  return { status, stdout, stderr };
}

describe("takode reconnect", () => {
  it("requests all-worker reconnect without sending task content and prints compact results", async () => {
    const bodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-reconnect", isOrchestrator: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/takode/reconnect") {
        bodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            all: true,
            requested: 2,
            started: 1,
            skipped: 1,
            failed: 0,
            results: [
              {
                ref: "worker-2",
                sessionId: "worker-2",
                sessionNum: 2,
                name: "Recovery Worker",
                status: "started",
                reason: "reconnect_started",
              },
              {
                ref: "worker-3",
                sessionId: "worker-3",
                sessionNum: 3,
                name: "Healthy Worker",
                status: "skipped",
                reason: "already_connected",
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["reconnect", "--all"], port);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(bodies).toEqual([{ all: true }]);
      expect(result.stdout).toContain("Reconnect started for #2 Recovery Worker");
      expect(result.stdout).toContain("Skipped #3 Healthy Worker: already connected");
      expect(result.stdout).toContain("Reconnect results: 1 started, 1 skipped, 0 failed.");
    } finally {
      server.close();
    }
  });

  it("keeps selected refs compact in JSON requests", async () => {
    const bodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-reconnect", isOrchestrator: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/takode/reconnect") {
        bodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, all: false, requested: 2, started: 0, skipped: 2, failed: 0, results: [] }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["reconnect", "2,3", "--json"], port);
      expect(result.status).toBe(0);
      expect(bodies).toEqual([{ workerIds: ["2", "3"] }]);
      expect(JSON.parse(result.stdout)).toMatchObject({ all: false, requested: 2 });
    } finally {
      server.close();
    }
  });
});
