import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
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

describe("takode context-doctor", () => {
  it("keeps usage history behind explicit reveal while printing drill-down commands", async () => {
    // The CLI command is itself opt-in, but its defaults still avoid bulky
    // histories. Source drill-downs point back to read/peek instead of dumping
    // raw messages or tool results.
    const compactPayload = {
      sessionId: "diag-session",
      sessionNum: 77,
      history: {
        messageCount: 4,
        turnCount: 1,
        messageJsonBytes: 2048,
        toolResultBytes: 8192,
        hiddenToolResultBytes: 4096,
        totalObservableBytes: 6144,
      },
      byMessageType: { assistant: { count: 1, bytes: 1024 } },
      byTool: { Bash: { calls: 1, inputBytes: 80, resultBytes: 8192, hiddenResultBytes: 4096 } },
      byCommandFamily: { "quest show": { calls: 1, inputBytes: 60, resultBytes: 8192, hiddenResultBytes: 4096 } },
      topEntries: [
        {
          kind: "tool_result",
          bytes: 8192,
          messageIndex: 2,
          turn: 0,
          toolUseId: "tool-1",
          toolName: "Bash",
          commandFamily: "quest show",
          commandSummary: "quest show q-1452",
          readCommand: "takode read 77 2",
          peekCommand: "takode peek 77 --turn-containing 2",
        },
      ],
      topTurns: [
        {
          turn: 0,
          startIndex: 0,
          endIndex: 3,
          messageCount: 4,
          messageBytes: 2048,
          toolResultBytes: 8192,
          hiddenToolResultBytes: 4096,
          totalObservableBytes: 6144,
        },
      ],
      contextUsageHistoryCount: 1,
      latestContextUsage: { timestamp: 123, source: "codex_token_usage", contextUsedPercent: 33 },
      limitation:
        "Diagnostics use observable Takode message/tool-result payload bytes plus reported context usage samples. Hidden reasoning and provider-side state are not directly measured.",
    };
    const revealedPayload = {
      ...compactPayload,
      contextUsageHistory: [{ timestamp: 123, source: "codex_token_usage", contextUsedPercent: 33 }],
    };

    const server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";
      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader", isOrchestrator: true }));
        return;
      }
      if (method === "GET" && url === "/api/sessions/77/context-diagnostics?limit=10") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(compactPayload));
        return;
      }
      if (method === "GET" && url === "/api/sessions/77/context-diagnostics?limit=10&history=true") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(revealedPayload));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `unexpected ${method} ${url}` }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const env = { ...process.env, COMPANION_SESSION_ID: "leader", COMPANION_AUTH_TOKEN: "auth" };

    try {
      const text = await runTakode(["context-doctor", "77", "--port", String(port)], env);
      const compactJson = await runTakode(["context-doctor", "77", "--json", "--port", String(port)], env);
      const historyJson = await runTakode(["context-doctor", "77", "--json", "--history", "--port", String(port)], env);

      expect(text.status).toBe(0);
      expect(text.stdout).toContain("Hidden reasoning and provider-side state are not directly measured.");
      expect(text.stdout).toContain("Bash command-family bytes:");
      expect(text.stdout).toContain("quest show");
      expect(text.stdout).toContain("command: quest show q-1452");
      expect(text.stdout).toContain("read: takode read 77 2");
      expect(text.stdout).toContain("turn: takode peek 77 --turn-containing 2");

      expect(compactJson.status).toBe(0);
      expect(JSON.parse(compactJson.stdout)).not.toHaveProperty("contextUsageHistory");

      expect(historyJson.status).toBe(0);
      expect(JSON.parse(historyJson.stdout)).toHaveProperty("contextUsageHistory");
    } finally {
      server.close();
    }
  });
});
