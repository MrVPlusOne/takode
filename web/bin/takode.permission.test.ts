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
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
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

describe("takode permission", () => {
  it("prints a Codex session's permission mode using the user-facing profile label", async () => {
    // Validates that inspect behavior is permission-specific even though
    // `takode info` also includes permission metadata.
    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-permission", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/worker-permission/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "worker-permission",
            sessionNum: 72,
            name: "Permission Worker",
            state: "idle",
            backendType: "codex",
            cwd: "/tmp/permission-worker",
            createdAt: Date.now(),
            cliConnected: true,
            isGenerating: false,
            permissionMode: "codex-auto-review",
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

    const result = await runTakode(["permission", "get", "worker-permission", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-permission",
      COMPANION_AUTH_TOKEN: "auth-permission",
    });

    server.close();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('#72 "Permission Worker" permission');
    expect(result.stdout).toContain("Backend: codex");
    expect(result.stdout).toContain("Permission: auto-review (codex-auto-review)");
  });

  it("sets a Codex profile by posting the backend-native runtime mode with leader ownership", async () => {
    // Validates the leader-safe update path: the CLI resolves the display
    // mode to the stored Codex profile and passes the caller as leaderSessionId.
    const postBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-permission", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/worker-permission/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "worker-permission",
            sessionNum: 73,
            name: "Permission Setter",
            state: "idle",
            backendType: "codex",
            cwd: "/tmp/permission-setter",
            createdAt: Date.now(),
            cliConnected: true,
            isGenerating: false,
            permissionMode: "codex-default",
          }),
        );
        return;
      }

      if (method === "POST" && url === "/api/sessions/worker-permission/permission-mode") {
        postBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId: "worker-permission", permissionMode: "codex-full-access" }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(["permission", "set", "worker-permission", "full-access", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-permission",
      COMPANION_AUTH_TOKEN: "auth-permission",
    });

    server.close();

    expect(result.status).toBe(0);
    expect(postBodies).toEqual([{ mode: "codex-full-access", leaderSessionId: "leader-permission" }]);
    expect(result.stdout).toContain('#73 "Permission Setter" permission updated');
    expect(result.stdout).toContain("Permission: full-access (codex-full-access)");
  });

  it("rejects a Claude mode before posting it to a Codex session", async () => {
    // Prevents broad legacy aliases from reaching the runtime route for Codex workers.
    let postCount = 0;
    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-permission", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/worker-permission/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "worker-permission",
            sessionNum: 74,
            state: "idle",
            backendType: "codex",
            cwd: "/tmp/permission-invalid",
            createdAt: Date.now(),
            cliConnected: true,
            isGenerating: false,
            permissionMode: "codex-default",
          }),
        );
        return;
      }

      if (method === "POST" && url === "/api/sessions/worker-permission/permission-mode") {
        postCount++;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(["permission", "set", "worker-permission", "plan", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-permission",
      COMPANION_AUTH_TOKEN: "auth-permission",
    });

    server.close();

    expect(result.status).toBe(1);
    expect(postCount).toBe(0);
    expect(result.stderr).toContain("Unsupported permission mode for codex session: plan");
  });
});
