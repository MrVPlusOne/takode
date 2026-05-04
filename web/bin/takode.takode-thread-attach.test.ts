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

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
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

describe("takode thread attach", () => {
  it("sends visible turn selectors to the thread attach route", async () => {
    // Leaders should be able to backfill from takode scan/peek turn numbers,
    // not only raw messageHistory array indices.
    const calls: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-thread", isOrchestrator: true }));
        return;
      }
      if (method === "POST" && url === "/api/sessions/leader-thread/thread/attach") {
        calls.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId: "leader-thread", questId: "q-941", attached: [3, 4, 5] }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["thread", "attach", "q-941", "--turn", "1", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-thread",
        COMPANION_AUTH_TOKEN: "auth-thread",
      });

      expect(result.status).toBe(0);
      expect(calls).toEqual([{ questId: "q-941", turn: 1 }]);
      expect(result.stdout).toContain("Attached 3, 4, 5 to q-941");
    } finally {
      server.close();
    }
  });

  it("sends multiple message selectors in one attach call", async () => {
    const calls: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-thread", isOrchestrator: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/sessions/leader-thread/thread/attach") {
        calls.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId: "leader-thread", questId: "q-941", attached: [140, 143, 146] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(
        ["thread", "attach", "q-941", "--message", "140", "143", "146", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "leader-thread",
          COMPANION_AUTH_TOKEN: "auth-thread",
        },
      );

      expect(result.status).toBe(0);
      expect(calls).toEqual([{ questId: "q-941", messages: [140, 143, 146] }]);
      expect(result.stdout).toContain("Attached 140, 143, 146 to q-941");
    } finally {
      server.close();
    }
  });
});
