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
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();

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

describe("takode spawn model payloads", () => {
  it("keeps the spawn create payload model-free when --model is omitted", async () => {
    const createBodies: JsonObject[] = [];

    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-cross-backend", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/leader-cross-backend") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "leader-cross-backend",
            permissionMode: "plan",
            backendType: "codex",
            model: "ignored-at-cli-layer",
          }),
        );
        return;
      }

      if (method === "POST" && url === "/api/sessions/create") {
        createBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-cross-backend" }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/worker-cross-backend/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "worker-cross-backend",
            sessionNum: 51,
            name: "Worker Cross Backend",
            state: "running",
            backendType: "claude",
            model: "claude-sonnet-4-5-20250929",
            cwd: "/tmp/worker-cross-backend",
            createdAt: Date.now(),
            cliConnected: true,
            isGenerating: false,
            askPermission: true,
            isWorktree: true,
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

    const result = await runTakode(["spawn", "--port", String(port), "--backend", "claude"], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-cross-backend",
      COMPANION_AUTH_TOKEN: "auth-cross-backend",
    });

    server.close();

    expect(result.status).toBe(0);
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toEqual({
      backend: "claude",
      cwd: process.cwd(),
      useWorktree: true,
      createdBy: "leader-cross-backend",
    });
  });

  it("still forwards an explicit --model override", async () => {
    const createBodies: JsonObject[] = [];

    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-explicit-model", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/leader-explicit-model") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "leader-explicit-model",
            permissionMode: "plan",
            backendType: "codex",
            model: "gpt-5.5",
          }),
        );
        return;
      }

      if (method === "POST" && url === "/api/sessions/create") {
        createBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-explicit-model" }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/worker-explicit-model/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "worker-explicit-model",
            sessionNum: 52,
            name: "Worker Explicit Model",
            state: "running",
            backendType: "claude",
            model: "claude-opus-4-5-20250929",
            cwd: "/tmp/worker-explicit-model",
            createdAt: Date.now(),
            cliConnected: true,
            isGenerating: false,
            askPermission: true,
            isWorktree: true,
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

    const result = await runTakode(["spawn", "--port", String(port), "--backend", "claude", "--model", "custom"], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-explicit-model",
      COMPANION_AUTH_TOKEN: "auth-explicit-model",
    });

    server.close();

    expect(result.status).toBe(0);
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toEqual({
      backend: "claude",
      cwd: process.cwd(),
      useWorktree: true,
      createdBy: "leader-explicit-model",
      model: "custom",
    });
  });

  // A worker on a remote host works in that host's checkout but keeps the
  // leader's checkout (on the leader's machine) as its port target.
  it("spawns on a named host with the leader's checkout as port target", async () => {
    const createBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const route = `${req.method} ${req.url}`;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (route === "GET /api/takode/me") return json(200, { sessionId: "leader-host", isOrchestrator: true });
      if (route === "GET /api/sessions/leader-host") {
        return json(200, {
          sessionId: "leader-host",
          sessionNum: 9,
          backendType: "claude",
          cwd: "/repos/app",
          repoRoot: "/repos/app",
          gitBranch: "main",
        });
      }
      if (route === "GET /api/hosts") return json(200, { hosts: [{ id: "host-id-1", name: "devbox" }] });
      if (route === "POST /api/sessions/create") {
        createBodies.push(await readJson(req));
        return json(200, { sessionId: "worker-host" });
      }
      if (route === "GET /api/sessions/worker-host/info") {
        return json(200, { sessionId: "worker-host", sessionNum: 53, state: "running", cwd: "/srv/app" });
      }
      return json(404, { error: "not found" });
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const env = { ...process.env, COMPANION_SESSION_ID: "leader-host", COMPANION_AUTH_TOKEN: "auth-host" };
    const missingCwd = await runTakode(["spawn", "--port", String(port), "--host", "devbox"], env);
    const result = await runTakode(["spawn", "--port", String(port), "--host", "devbox", "--cwd", "/srv/app"], env);
    server.close();

    expect(missingCwd.status).not.toBe(0);
    expect(missingCwd.stderr).toContain("--host needs --cwd");
    expect(result.status).toBe(0);
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      cwd: "/srv/app",
      useWorktree: true,
      hostId: "host-id-1",
      branch: "main",
      worktreePortTarget: { repoRoot: "/repos/app", branch: "main", worktreePath: "/repos/app", sourceSessionNum: 9 },
    });
    expect((createBodies[0].worktreePortTarget as JsonObject).hostId).toBeUndefined();
  });
});
