import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
    cwd,
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

function makeLongContent(prefix: string, fillerLength: number, marker: string): string {
  return `${prefix}${"x".repeat(fillerLength)} ${marker} ${"y".repeat(40)}`;
}

describe("takode peek/scan source-aware truncation", () => {
  it("keeps scan especially aggressive for herd prompts while preserving user and agent source labels", async () => {
    const userContent = makeLongContent("human-summary ", 180, "USER_SCAN_KEEP");
    const herdContent = makeLongContent("herd-summary ", 180, "HERD_SCAN_HIDE");
    const agentContent = makeLongContent("agent-summary ", 120, "AGENT_SCAN_KEEP");

    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-scan-source", isOrchestrator: false }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/153/messages?scan=turns&fromTurn=0&turnCount=3") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sid: "worker-153",
            sn: 153,
            name: "Scan Worker",
            status: "idle",
            quest: null,
            mode: "turn_scan",
            totalTurns: 3,
            totalMessages: 9,
            from: 0,
            count: 3,
            turns: [
              {
                turn: 0,
                si: 0,
                ei: 2,
                start: Date.now() - 90_000,
                end: Date.now() - 60_000,
                dur: 30_000,
                stats: { tools: 0, messages: 3, subagents: 0 },
                user: userContent,
                result: "user turn done",
              },
              {
                turn: 1,
                si: 3,
                ei: 5,
                start: Date.now() - 60_000,
                end: Date.now() - 40_000,
                dur: 20_000,
                stats: { tools: 0, messages: 3, subagents: 0 },
                user: herdContent,
                result: "herd turn done",
                agent: { sessionId: "herd-events" },
              },
              {
                turn: 2,
                si: 6,
                ei: 8,
                start: Date.now() - 30_000,
                end: Date.now() - 10_000,
                dur: 20_000,
                stats: { tools: 0, messages: 3, subagents: 0 },
                user: agentContent,
                result: "agent turn done",
                agent: { sessionId: "session-7", sessionLabel: "System" },
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
      const result = await runTakode(["scan", "153", "--from", "0", "--count", "3", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-scan-source",
        COMPANION_AUTH_TOKEN: "auth-scan-source",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("user:");
      expect(result.stdout).toContain("herd:");
      expect(result.stdout).toContain("agent System:");
      expect(result.stdout).toContain("USER_SCAN_KEEP");
      expect(result.stdout).toContain("AGENT_SCAN_KEEP");
      expect(result.stdout).not.toContain("HERD_SCAN_HIDE");
    } finally {
      server.close();
    }
  });

  it("gives peek user messages more visible space than herd messages while keeping source provenance", async () => {
    const userContent = makeLongContent("peek-user ", 360, "USER_PEEK_KEEP");
    const herdContent = makeLongContent("peek-herd ", 360, "HERD_PEEK_HIDE");
    const agentContent = makeLongContent("peek-agent ", 220, "AGENT_PEEK_KEEP");

    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-peek-source", isOrchestrator: false }));
        return;
      }

      if (method === "GET" && url === "/api/sessions/153/messages?count=3&from=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sid: "worker-153",
            sn: 153,
            name: "Peek Worker",
            status: "idle",
            quest: null,
            mode: "range",
            totalMessages: 3,
            from: 0,
            to: 2,
            bounds: [{ turn: 0, si: 0, ei: 2 }],
            messages: [
              {
                idx: 0,
                type: "user",
                ts: Date.now() - 30_000,
                content: userContent,
              },
              {
                idx: 1,
                type: "user",
                ts: Date.now() - 20_000,
                content: herdContent,
                agent: { sessionId: "herd-events" },
              },
              {
                idx: 2,
                type: "user",
                ts: Date.now() - 10_000,
                content: agentContent,
                agent: { sessionId: "session-9", sessionLabel: "System" },
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
      const result = await runTakode(["peek", "153", "--from", "0", "--count", "3", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-peek-source",
        COMPANION_AUTH_TOKEN: "auth-peek-source",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("user  ");
      expect(result.stdout).toContain("herd  ");
      expect(result.stdout).toContain("agent System");
      expect(result.stdout).toContain("USER_PEEK_KEEP");
      expect(result.stdout).toContain("AGENT_PEEK_KEEP");
      expect(result.stdout).not.toContain("HERD_PEEK_HIDE");
    } finally {
      server.close();
    }
  });
});
