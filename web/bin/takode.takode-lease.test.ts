import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { handleLease, type TakodeLeaseDeps } from "./takode-lease.js";

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
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
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

describe("takode lease", () => {
  it("acquires a lease with purpose, ttl, quest, wait, and metadata payload", async () => {
    let receivedBody: JsonObject | null = null;
    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-self", isOrchestrator: false }));
        return;
      }

      if (method === "POST" && url === "/api/resource-leases/dev-server%3Acompanion/acquire") {
        receivedBody = await readJson(req);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            result: {
              status: "acquired",
              capacity: 1,
              lease: {
                resourceKey: "dev-server:companion",
                slot: 1,
                ownerSessionId: "worker-self",
                questId: "q-979",
                purpose: "Run E2E verification",
                metadata: { url: "http://localhost:5174" },
                acquiredAt: Date.now(),
                heartbeatAt: Date.now(),
                ttlMs: 1_800_000,
                expiresAt: Date.now() + 1_800_000,
              },
              waiters: [],
            },
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
      const result = await runTakode(
        [
          "lease",
          "acquire",
          "dev-server:companion",
          "--purpose",
          "Run E2E verification",
          "--ttl",
          "30m",
          "--quest",
          "q-979",
          "--metadata",
          "url=http://localhost:5174",
          "--wait",
          "--port",
          String(port),
        ],
        {
          ...process.env,
          COMPANION_SESSION_ID: "worker-self",
          COMPANION_AUTH_TOKEN: "auth-self",
        },
      );

      expect(result.status).toBe(0);
      expect(receivedBody).toEqual({
        purpose: "Run E2E verification",
        metadata: { url: "http://localhost:5174" },
        ttlMs: 1_800_000,
        questId: "q-979",
        wait: true,
      });
      expect(result.stdout).toContain("Acquired dev-server:companion");
    } finally {
      server.close();
    }
  });

  it("prints lease status and supports json mode", async () => {
    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-self", isOrchestrator: false }));
        return;
      }

      if (method === "GET" && url === "/api/resource-leases/agent-browser") {
        const now = Date.now();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            resource: {
              resourceKey: "agent-browser",
              available: false,
              capacity: 1,
              leases: [
                {
                  resourceKey: "agent-browser",
                  slot: 1,
                  ownerSessionId: "owner",
                  purpose: "Inspect UI",
                  questId: "q-979",
                  metadata: { viewport: "430x932" },
                  acquiredAt: now - 5 * 60_000,
                  heartbeatAt: now - 60_000,
                  ttlMs: 1_800_000,
                  expiresAt: now + 1_800_000,
                },
              ],
              waiters: [
                {
                  id: "w1",
                  resourceKey: "agent-browser",
                  waiterSessionId: "waiter",
                  questId: "q-980",
                  purpose: "Need browser next",
                  metadata: { device: "desktop" },
                  queuedAt: now - 2 * 60_000,
                  ttlMs: 1_200_000,
                },
              ],
            },
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
      const text = await runTakode(["lease", "status", "agent-browser", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-self",
        COMPANION_AUTH_TOKEN: "auth-self",
      });
      expect(text.status).toBe(0);
      expect(text.stdout).toContain("agent-browser: 1/1 slots held, 0 free");
      expect(text.stdout).toContain("owner: owner");
      expect(text.stdout).toContain("acquired:");
      expect(text.stdout).toContain("heartbeat:");
      expect(text.stdout).toContain("ttl: 30m");
      expect(text.stdout).toContain("expires:");
      expect(text.stdout).toContain("quest: q-979");
      expect(text.stdout).toContain("metadata: viewport=430x932");
      expect(text.stdout).toContain("purpose: Inspect UI");
      expect(text.stdout).toContain("waiters: 1");
      expect(text.stdout).toContain("w1: waiter");
      expect(text.stdout).toContain("queued:");
      expect(text.stdout).toContain("requested ttl: 20m");
      expect(text.stdout).toContain("quest: q-980");
      expect(text.stdout).toContain("metadata: device=desktop");
      expect(text.stdout).toContain("purpose: Need browser next");

      const json = await runTakode(["lease", "status", "agent-browser", "--json", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-self",
        COMPANION_AUTH_TOKEN: "auth-self",
      });
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout).resource.resourceKey).toBe("agent-browser");
    } finally {
      server.close();
    }
  });

  it("prints queued wait details and no-poll guidance", async () => {
    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-self", isOrchestrator: false }));
        return;
      }

      if (method === "POST" && url === "/api/resource-leases/agent-browser/wait") {
        const now = Date.now();
        res.writeHead(202, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            result: {
              status: "queued",
              position: 2,
              resourceKey: "agent-browser",
              capacity: 1,
              available: false,
              leases: [
                {
                  resourceKey: "agent-browser",
                  slot: 1,
                  ownerSessionId: "owner-session-id",
                  ownerSessionNum: 1370,
                  ownerSessionName: "Questmaster Execute",
                  questId: "q-1051",
                  purpose: "Execute validation for q-1051",
                  metadata: {},
                  acquiredAt: now - 120_000,
                  heartbeatAt: now - 30_000,
                  ttlMs: 1_800_000,
                  expiresAt: now + 1_770_000,
                },
              ],
              waiter: {
                id: "w2",
                resourceKey: "agent-browser",
                waiterSessionId: "worker-self",
                waiterSessionNum: 1364,
                waiterSessionName: "Notification Execute",
                questId: "q-1060",
                purpose: "Execute q-1060 browser validation",
                metadata: {},
                queuedAt: now,
                ttlMs: 1_800_000,
              },
              waiters: [
                {
                  id: "w1",
                  resourceKey: "agent-browser",
                  waiterSessionId: "other-waiter",
                  purpose: "Already queued",
                  metadata: {},
                  queuedAt: now - 10_000,
                  ttlMs: 1_800_000,
                },
                {
                  id: "w2",
                  resourceKey: "agent-browser",
                  waiterSessionId: "worker-self",
                  waiterSessionNum: 1364,
                  waiterSessionName: "Notification Execute",
                  questId: "q-1060",
                  purpose: "Execute q-1060 browser validation",
                  metadata: {},
                  queuedAt: now,
                  ttlMs: 1_800_000,
                },
              ],
            },
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
      const result = await runTakode(
        ["lease", "wait", "agent-browser", "--purpose", "Execute q-1060 browser validation", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "worker-self",
          COMPANION_AUTH_TOKEN: "auth-self",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Queued for agent-browser at position 2 of 2.");
      expect(result.stdout).toContain("slot 1 owner: #1370 Questmaster Execute (owner-session-id)");
      expect(result.stdout).toContain("quest: q-1051");
      expect(result.stdout).toContain("purpose: Execute validation for q-1051");
      expect(result.stdout).toContain("Resource Lease message");
      expect(result.stdout).toContain("no polling is needed");
    } finally {
      server.close();
    }
  });

  it.each([
    { force: false, json: false },
    { force: true, json: false },
    { force: true, json: true },
  ])("sends an explicit release override and reports the result (force=$force, json=$json)", async ({
    force,
    json,
  }) => {
    // Run the actual CLI against an isolated stub. Ordinary release keeps its
    // existing payload; --force must reach the server and identify the old owner.
    let receivedBody: JsonObject | null = null;
    const now = Date.now();
    const lease = {
      resourceKey: "agent-browser",
      slot: 1,
      ownerSessionId: "previous-owner",
      ownerSessionNum: 12,
      ownerSessionName: "Previous Worker",
      purpose: "Inspect UI",
      metadata: {},
      acquiredAt: now,
      heartbeatAt: now,
      ttlMs: 1_800_000,
      expiresAt: now + 1_800_000,
    };
    const responseBody = {
      result: { released: lease, promoted: { ...lease, ownerSessionId: "next-waiter" }, waiters: [] },
    };
    const server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.end(JSON.stringify({ sessionId: "leader-self", isOrchestrator: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/resource-leases/agent-browser/release") {
        receivedBody = await readJson(req);
        res.end(JSON.stringify(responseBody));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    try {
      const args = ["lease", "release", "agent-browser", "--port", String((server.address() as AddressInfo).port)];
      if (force) args.push("--force");
      if (json) args.push("--json");
      const result = await runTakode(args, {
        ...process.env,
        COMPANION_SESSION_ID: "leader-self",
        COMPANION_AUTH_TOKEN: "auth-self",
      });
      expect(result.status).toBe(0);
      expect(receivedBody).toEqual(force ? { force: true } : {});
      if (json) {
        expect(JSON.parse(result.stdout)).toEqual(responseBody);
      } else {
        expect(result.stdout).toContain(force ? "Force-released agent-browser" : "Released agent-browser");
        if (force) expect(result.stdout).toContain("previous owner: #12 Previous Worker (previous-owner)");
        expect(result.stdout).toContain("Promoted next-waiter");
      }
    } finally {
      server.close();
    }
  });
  it("sends capacity and optional slot arguments and keeps global list output compact", async () => {
    // The command boundary should carry numeric targeting and keep uncommon
    // metadata in explicit per-resource inspection rather than every list row.
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const lease = {
      resourceKey: "test-server",
      slot: 2,
      ownerSessionId: "worker",
      metadata: { detail: "long-detail" },
      purpose: "Check",
      acquiredAt: 1,
      heartbeatAt: 1,
      expiresAt: 2,
      ttlMs: 1,
    };
    const pool = { resourceKey: "test-server", capacity: 3, leases: [lease], waiters: [], available: true };
    const deps: TakodeLeaseDeps = {
      apiGet: vi.fn(async () => ({ resources: [pool] })),
      apiPost: vi.fn(async () => ({ resource: pool, lease, result: { released: lease, promoted: null, waiters: [] } })),
      err: (message) => {
        throw new Error(message);
      },
      formatInlineText: String,
      formatTimestampCompact: String,
    };
    try {
      await handleLease(["configure", "test-server", "--capacity", "3"], deps);
      expect(deps.apiPost).toHaveBeenLastCalledWith("/resource-leases/test-server/configure", { capacity: 3 });
      await handleLease(["renew", "test-server", "--slot", "2", "--ttl", "1m"], deps);
      expect(deps.apiPost).toHaveBeenLastCalledWith("/resource-leases/test-server/renew", { slot: 2, ttlMs: 60_000 });
      await handleLease(["release", "test-server", "--slot", "2", "--force"], deps);
      expect(deps.apiPost).toHaveBeenLastCalledWith("/resource-leases/test-server/release", { slot: 2, force: true });
      output.mockClear();
      await handleLease(["list"], deps);
      expect(output).toHaveBeenCalledExactlyOnceWith("test-server: 1/3 slots held, 2 free; 0 waiting");
      expect(output.mock.calls.flat().join(" ")).not.toContain("long-detail");
      for (const value of ["0", "-1", "2.5", "NaN", "9007199254740992"]) {
        await expect(handleLease(["configure", "test-server", "--capacity", value], deps)).rejects.toThrow(
          "positive integer",
        );
        await expect(handleLease(["release", "test-server", "--slot", value], deps)).rejects.toThrow(
          "positive integer",
        );
      }
      await expect(handleLease(["configure", "test-server"], deps)).rejects.toThrow("--capacity is required");
      await expect(handleLease(["renew", "test-server", "--slot"], deps)).rejects.toThrow("positive integer");
    } finally {
      output.mockRestore();
    }
  });
});
