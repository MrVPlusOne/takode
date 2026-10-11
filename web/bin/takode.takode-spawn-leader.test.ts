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
    req.on("end", () => resolve(body ? (JSON.parse(body) as JsonObject) : {}));
  });
}

async function runTakode(args: string[], port: number) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    env: { ...process.env, COMPANION_SESSION_ID: "leader-1", COMPANION_AUTH_TOKEN: "auth-1" },
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

/**
 * A fake Takode server with one leader in the MSI session space, a second
 * session space and a remote host, recording every create request.
 */
async function startFakeServer() {
  const createBodies: JsonObject[] = [];
  const json = (res: import("node:http").ServerResponse, body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    const method = req.method || "";
    const url = req.url || "";
    if (method === "GET" && url === "/api/takode/me") return json(res, { sessionId: "leader-1", isOrchestrator: true });
    if (method === "GET" && url === "/api/sessions/leader-1") {
      return json(res, {
        sessionId: "leader-1",
        sessionNum: 7,
        backendType: "codex",
        cwd: "/home/me",
        isWorktree: false,
        memorySessionSpaceSlug: "MSI",
      });
    }
    if (method === "GET" && url === "/api/tree-groups") {
      return json(res, {
        groups: [
          { id: "default", name: "Default" },
          { id: "group-msi", name: "MSI" },
          { id: "group-takode", name: "Takode" },
        ],
      });
    }
    if (method === "GET" && url === "/api/hosts") {
      return json(res, { hosts: [{ id: "host-devbox", name: "devbox" }], local: { name: "laptop" } });
    }
    if (method === "POST" && url === "/api/sessions/create") {
      createBodies.push(await readJson(req));
      return json(res, { sessionId: "leader-2" });
    }
    if (method === "GET" && url === "/api/sessions/leader-2/info") {
      return json(res, {
        sessionId: "leader-2",
        sessionNum: 8,
        name: "Leader 3",
        backendType: "codex",
        cwd: "/home/me",
      });
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0);
  await once(server, "listening");
  return { server, port: (server.address() as AddressInfo).port, createBodies };
}

describe("takode spawn --leader", () => {
  it("creates an unherded, worktree-free leader in the creator's session space and memory space", async () => {
    // The create request names the creator (so the server inherits its session
    // space) and its memory space, and asks for the orchestrator role; the
    // server keeps a created leader out of its creator's herd.
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", "--leader", "--json"], port);
      expect(result.status).toBe(0);
      expect(createBodies).toHaveLength(1);
      expect(createBodies[0]).toMatchObject({
        role: "orchestrator",
        createdBy: "leader-1",
        memorySessionSpaceSlug: "MSI",
        useWorktree: false,
      });
      expect(createBodies[0]).not.toHaveProperty("treeGroupId");
      expect(createBodies[0]).not.toHaveProperty("worktreePortTarget");
    } finally {
      server.close();
    }
  });

  it("creates the leader on another host when --host and --cwd name it", async () => {
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", "--leader", "--host", "devbox", "--cwd", "/home/coder", "--json"], port);
      expect(result.status).toBe(0);
      expect(createBodies[0]).toMatchObject({
        role: "orchestrator",
        hostId: "host-devbox",
        cwd: "/home/coder",
        memorySessionSpaceSlug: "MSI",
      });
    } finally {
      server.close();
    }
  });

  it("puts the leader in a named session space and lets that space choose the memory space", async () => {
    // Without --memory-space, the creator's memory space must not be sent, or
    // it would disagree with the chosen session space and be rejected.
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", "--leader", "--session-space", "takode", "--json"], port);
      expect(result.status).toBe(0);
      expect(createBodies[0]).toMatchObject({ role: "orchestrator", treeGroupId: "group-takode" });
      expect(createBodies[0]).not.toHaveProperty("memorySessionSpaceSlug");
    } finally {
      server.close();
    }
  });

  it("sends an explicit memory space alone so the server picks its session space", async () => {
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", "--leader", "--memory-space", "Takode", "--json"], port);
      expect(result.status).toBe(0);
      expect(createBodies[0]).toMatchObject({ memorySessionSpaceSlug: "Takode" });
      expect(createBodies[0]).not.toHaveProperty("treeGroupId");
    } finally {
      server.close();
    }
  });

  it("rejects an unknown session space before creating anything", async () => {
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", "--leader", "--session-space", "Nowhere"], port);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Unknown session space: Nowhere");
      expect(createBodies).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it.each([
    [["--leader", "--reviewer", "3"], "--leader cannot be combined with --reviewer"],
    [["--leader", "--count", "2"], "--leader cannot be combined with --count"],
    [["--session-space", "MSI"], "--session-space is only supported with --leader"],
    [["--memory-space", "MSI"], "--memory-space is only supported with --leader"],
  ])("rejects %j", async (flags, message) => {
    const { server, port, createBodies } = await startFakeServer();
    try {
      const result = await runTakode(["spawn", ...flags], port);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
      expect(createBodies).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
