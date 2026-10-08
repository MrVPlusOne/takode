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

  // A leader already on the host spawns there like a local spawn: the `--cwd`
  // checkout's own branch is the base and port target, which the server reads
  // on the host. The leader's detached checkout (branch `HEAD`) must not become
  // the branch, or the worktree would start from origin/HEAD.
  it("leaves the base branch to the host checkout when the leader is on that host", async () => {
    const createBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const route = `${req.method} ${req.url}`;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (route === "GET /api/takode/me") return json(200, { sessionId: "leader-on-host", isOrchestrator: true });
      if (route === "GET /api/sessions/leader-on-host") {
        return json(200, {
          sessionId: "leader-on-host",
          backendType: "claude",
          cwd: "/home/coder/takode",
          repoRoot: "/home/coder/takode",
          gitBranch: "HEAD",
          hostId: "host-id-1",
        });
      }
      if (route === "GET /api/hosts") return json(200, { hosts: [{ id: "host-id-1", name: "devbox" }] });
      if (route === "POST /api/sessions/create") {
        createBodies.push(await readJson(req));
        return json(200, { sessionId: "worker-on-host" });
      }
      if (route === "GET /api/sessions/worker-on-host/info") {
        return json(200, { sessionId: "worker-on-host", sessionNum: 54, state: "running", cwd: "/home/coder/app" });
      }
      return json(404, { error: "not found" });
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const env = { ...process.env, COMPANION_SESSION_ID: "leader-on-host", COMPANION_AUTH_TOKEN: "auth-host" };
    const args = ["spawn", "--port", String(port), "--host", "devbox", "--cwd", "/home/coder/app"];
    const result = await runTakode(args, env);
    server.close();

    expect(result.status).toBe(0);
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({ cwd: "/home/coder/app", useWorktree: true, hostId: "host-id-1" });
    expect(createBodies[0].branch).toBeUndefined();
    expect(createBodies[0].worktreePortTarget).toBeUndefined();
  });

  // Without --host, a worker runs on the leader's own machine; for a leader on a
  // host, the default cwd is the CLI's (which runs on that host). --host naming
  // the coordinator's machine overrides that and is a cross-machine spawn, so
  // it needs --cwd and ports back to the leader's checkout. A reviewer runs on
  // its parent worker's machine.
  it("defaults workers to the leader's machine and resolves the coordinator by name", async () => {
    const createBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const route = `${req.method} ${req.url}`;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (route === "GET /api/takode/me") return json(200, { sessionId: "remote-leader", isOrchestrator: true });
      if (route === "GET /api/sessions/remote-leader") {
        return json(200, {
          sessionId: "remote-leader",
          sessionNum: 7,
          backendType: "claude",
          cwd: "/home/coder/app",
          repoRoot: "/home/coder/app",
          gitBranch: "jiayi",
          hostId: "host-id-1",
        });
      }
      if (route === "GET /api/hosts") {
        return json(200, { hosts: [{ id: "host-id-1", name: "devbox" }], local: { id: "local", name: "laptop" } });
      }
      if (route === "GET /api/takode/sessions") {
        return json(200, [
          { sessionId: "laptop-worker", sessionNum: 60, cwd: "/Users/me/app-wt", hostId: null },
          { sessionId: "host-worker", sessionNum: 61, cwd: "/home/coder/app-wt", hostId: "host-id-1" },
        ]);
      }
      if (route === "POST /api/sessions/create") {
        createBodies.push(await readJson(req));
        return json(200, { sessionId: "new-worker" });
      }
      if (route === "GET /api/sessions/new-worker/info") {
        return json(200, { sessionId: "new-worker", sessionNum: 62, state: "running", cwd: "/somewhere" });
      }
      return json(404, { error: "not found" });
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const env = { ...process.env, COMPANION_SESSION_ID: "remote-leader", COMPANION_AUTH_TOKEN: "auth-host" };
    const spawn = (...args: string[]) => runTakode(["spawn", "--port", String(port), ...args], env);
    const onLeaderHost = await spawn();
    const onCoordinatorWithoutCwd = await spawn("--host", "laptop");
    const onCoordinator = await spawn("--host", "laptop", "--cwd", "/Users/me/app");
    const unknownHost = await spawn("--host", "nowhere", "--cwd", "/x");
    const reviewerOfHostWorker = await spawn("--reviewer", "61");
    const reviewerOfLaptopWorker = await spawn("--reviewer", "60");
    server.close();

    expect(onLeaderHost.status).toBe(0);
    expect(onCoordinatorWithoutCwd.stderr).toContain("--host needs --cwd");
    expect(onCoordinator.status).toBe(0);
    expect(unknownHost.stderr).toContain("Unknown host: nowhere. Machines: laptop, devbox.");
    expect(reviewerOfHostWorker.status).toBe(0);
    expect(reviewerOfLaptopWorker.status).toBe(0);
    expect(createBodies).toHaveLength(4);
    const [leaderHostBody, coordinatorBody, hostReviewerBody, laptopReviewerBody] = createBodies;
    expect(leaderHostBody).toMatchObject({ cwd: process.cwd(), useWorktree: true, hostId: "host-id-1" });
    expect(leaderHostBody.branch).toBeUndefined();
    expect(leaderHostBody.worktreePortTarget).toBeUndefined();
    expect(coordinatorBody).toMatchObject({
      cwd: "/Users/me/app",
      branch: "jiayi",
      worktreePortTarget: { repoRoot: "/home/coder/app", branch: "jiayi", hostId: "host-id-1" },
    });
    expect(coordinatorBody.hostId).toBeUndefined();
    expect(hostReviewerBody).toMatchObject({ cwd: "/home/coder/app-wt", reviewerOf: 61, hostId: "host-id-1" });
    expect(laptopReviewerBody).toMatchObject({ cwd: "/Users/me/app-wt", reviewerOf: 60 });
    expect(laptopReviewerBody.hostId).toBeUndefined();
  });
});
