import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

async function runTakode(args: string[], env: Record<string, string | undefined>) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
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

function session(sessionId: string, sessionNum: number, extra: Record<string, unknown> = {}) {
  return {
    sessionId,
    sessionNum,
    name: `Session ${sessionNum}`,
    state: "idle",
    archived: false,
    cwd: "/repo/companion",
    createdAt: Date.now() - 40_000,
    lastActivityAt: Date.now() - 5_000,
    cliConnected: true,
    ...extra,
  };
}

/** Serves a session list plus the registered hosts, recording each /api/hosts request. */
async function startServer(sessions: unknown[]) {
  const hostRequests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url || "";
    res.writeHead(url === "/api/takode/sessions" || url === "/api/hosts" ? 200 : 404, {
      "content-type": "application/json",
    });
    if (url === "/api/takode/sessions") return res.end(JSON.stringify(sessions));
    if (url === "/api/hosts") {
      hostRequests.push(url);
      return res.end(
        JSON.stringify({
          hosts: [
            { id: "host-online", name: "devbox", online: true },
            { id: "host-offline", name: "laptop", online: false },
          ],
        }),
      );
    }
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0);
  await once(server, "listening");
  return { server, port: (server.address() as AddressInfo).port, hostRequests };
}

// Leaders scan `takode list` to see where each worker runs: remote sessions carry
// an `@host` tag, local ones stay untagged, and listing only local sessions
// never asks the server for its hosts.
describe("takode list hosts", () => {
  const env = { ...process.env, COMPANION_SESSION_ID: undefined, COMPANION_AUTH_TOKEN: undefined };

  it("tags remote sessions with their host and its link status", async () => {
    const { server, port, hostRequests } = await startServer([
      session("local", 10),
      session("remote", 11, { hostId: "host-online" }),
      session("remote-offline", 12, { hostId: "host-offline" }),
      session("remote-removed", 13, { hostId: "0123456789abcdef" }),
    ]);
    try {
      const result = await runTakode(["list", "--port", String(port)], env);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/#10 +○ Session 10 ⏰/);
      expect(result.stdout).toMatch(/#11 +○ Session 11 @devbox ⏰/);
      expect(result.stdout).toMatch(/#12 +○ Session 12 @laptop\(offline\) ⏰/);
      expect(result.stdout).toMatch(/#13 +○ Session 13 @host:01234567 ⏰/);
      expect(result.stdout).toContain("@ remote host");
      expect(hostRequests).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("skips the host lookup when every session is local", async () => {
    const { server, port, hostRequests } = await startServer([session("local", 10)]);
    try {
      const result = await runTakode(["list", "--port", String(port)], env);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("@");
      expect(hostRequests).toEqual([]);
    } finally {
      server.close();
    }
  });
});
