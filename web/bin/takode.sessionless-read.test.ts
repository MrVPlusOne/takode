import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

function sessionlessEnv(home: string): Record<string, string | undefined> {
  return {
    ...process.env,
    COMPANION_SESSION_ID: undefined,
    COMPANION_AUTH_TOKEN: undefined,
    COMPANION_PORT: undefined,
    TAKODE_API_PORT: undefined,
    HOME: home,
  };
}

describe("takode sessionless read-only inspection", () => {
  it("allows session/history inspection commands without caller identity or auth headers", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "takode-sessionless-read-"));
    const requestUrls: string[] = [];
    const authHeaderValues: Array<string | string[] | undefined> = [];
    const now = 1_700_000_000_000;
    const server = createServer((req, res) => {
      requestUrls.push(req.url || "");
      authHeaderValues.push(req.headers["x-companion-session-id"], req.headers["x-companion-auth-token"]);
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "read-only commands must not preflight caller identity" }));
        return;
      }
      if (method === "GET" && url === "/api/takode/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              sessionId: "session-153",
              sessionNum: 153,
              name: "Sessionless Read",
              state: "idle",
              archived: false,
              cwd: "/repo",
              createdAt: now - 10_000,
              cliConnected: true,
              taskHistory: [],
            },
          ]),
        );
        return;
      }
      if (method === "GET" && url === "/api/sessions/153/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "session-153",
            sessionNum: 153,
            name: "Sessionless Read",
            state: "idle",
            backendType: "codex",
            model: "gpt",
            cwd: "/repo",
            createdAt: now - 10_000,
            lastActivityAt: now,
            cliConnected: true,
            isGenerating: false,
            injectedSystemPrompt: "large hidden prompt must stay out of compact JSON",
          }),
        );
        return;
      }
      if (method === "GET" && url === "/api/sessions/153/tasks") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "session-153",
            sessionNum: 153,
            sessionName: "Sessionless Read",
            totalMessages: 2,
            tasks: [
              {
                taskNum: 1,
                title: "Inspect history",
                startIdx: 0,
                endIdx: 1,
                startedAt: now - 1_000,
                source: "user",
                questId: null,
              },
            ],
          }),
        );
        return;
      }
      if (method === "GET" && url.startsWith("/api/sessions/153/messages?")) {
        const parsed = new URL(`http://localhost${url}`);
        if (parsed.searchParams.get("scan") === "turns") {
          const turnCount = Number(parsed.searchParams.get("turnCount") || "0");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              sid: "session-153",
              sn: 153,
              name: "Sessionless Read",
              status: "idle",
              quest: null,
              mode: "turn_scan",
              totalTurns: 1,
              totalMessages: 2,
              from: 0,
              count: turnCount,
              turns:
                turnCount > 0
                  ? [
                      {
                        turn: 0,
                        start: now - 1_000,
                        end: now,
                        dur: 1_000,
                        firstIdx: 0,
                        lastIdx: 1,
                        summary: "Inspect history",
                        stats: { tools: 0, messages: 2, subagents: 0 },
                      },
                    ]
                  : [],
            }),
          );
          return;
        }
      }
      if (method === "GET" && url === "/api/sessions/153/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sid: "session-153",
            sn: 153,
            name: "Sessionless Read",
            status: "idle",
            quest: null,
            mode: "default",
            totalTurns: 1,
            totalMessages: 2,
            collapsed: [],
            omitted: 0,
            expanded: {
              turn: 1,
              start: now - 1_000,
              end: now,
              dur: 1_000,
              messages: [
                { idx: 0, type: "user", content: "Needle request", ts: now - 1_000 },
                { idx: 1, type: "assistant", content: "Needle response", ts: now },
              ],
              stats: { tools: 0, messages: 2, subagents: 0 },
              omittedMsgs: 0,
            },
          }),
        );
        return;
      }
      if (method === "GET" && url === "/api/sessions/153/messages/1") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            idx: 1,
            type: "assistant",
            ts: now,
            totalLines: 1,
            offset: 0,
            limit: 200,
            content: "Needle response",
          }),
        );
        return;
      }
      if (method === "GET" && url === "/api/sessions/153/grep?q=needle&limit=50") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "session-153",
            sessionNum: 153,
            query: "needle",
            totalMatches: 1,
            matches: [{ idx: 1, type: "assistant", ts: now, snippet: "Needle response", turn: 1 }],
          }),
        );
        return;
      }
      if (method === "GET" && url === "/api/sessions/153/export") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "session-153", totalMessages: 2, totalTurns: 1, text: "exported text" }));
        return;
      }
      if (method === "GET" && url === "/api/sessions/search?q=Needle&includeArchived=false") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            query: "Needle",
            tookMs: 1,
            totalMatches: 1,
            results: [
              {
                sessionId: "session-153",
                score: 10,
                matchedField: "user_message",
                matchContext: "user_message: Needle request",
                matchedAt: now,
                messageMatch: { timestamp: now, snippet: "Needle request" },
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `not found: ${method} ${url}` }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const env = sessionlessEnv(tmp);

    try {
      const commands: Array<{ args: string[]; check: (result: Awaited<ReturnType<typeof runTakode>>) => void }> = [
        {
          args: ["list", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout)[0].sessionNum).toBe(153),
        },
        {
          args: ["info", "153", "--json", "--port", String(port)],
          check: (result) => {
            const json = JSON.parse(result.stdout);
            expect(json.sessionNum).toBe(153);
            expect(json.injectedSystemPrompt).toBeUndefined();
          },
        },
        {
          args: ["tasks", "153", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout).tasks).toHaveLength(1),
        },
        {
          args: ["scan", "153", "--count", "1", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout).mode).toBe("turn_scan"),
        },
        {
          args: ["peek", "153", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout).mode).toBe("default"),
        },
        {
          args: ["read", "153", "1", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout).content).toBe("Needle response"),
        },
        {
          args: ["grep", "153", "needle", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout).totalMatches).toBe(1),
        },
        {
          args: ["search", "Needle", "--json", "--port", String(port)],
          check: (result) => expect(JSON.parse(result.stdout)[0].sessionNum).toBe(153),
        },
      ];

      for (const command of commands) {
        const result = await runTakode(command.args, env, tmp);
        expect(result.status).toBe(0);
        command.check(result);
      }

      const exportPath = join(tmp, "history.txt");
      const exportResult = await runTakode(["export", "153", exportPath, "--port", String(port)], env, tmp);
      expect(exportResult.status).toBe(0);
      expect(readFileSync(exportPath, "utf-8")).toBe("exported text");

      expect(requestUrls).not.toContain("/api/takode/me");
      expect(authHeaderValues.every((value) => value === undefined)).toBe(true);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps mutating and unrelated read helpers protected without caller identity", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "takode-sessionless-protected-"));
    const requestUrls: string[] = [];
    const server = createServer((req, res) => {
      requestUrls.push(req.url || "");
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "protected commands should fail before unauthenticated requests" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const env = sessionlessEnv(tmp);

    try {
      for (const args of [
        ["send", "153", "retry", "--port", String(port)],
        ["logs", "--json", "--port", String(port)],
      ]) {
        const result = await runTakode(args, env, tmp);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("COMPANION_SESSION_ID not set");
      }
      expect(requestUrls).toEqual([]);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
