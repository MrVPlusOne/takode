import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSessionAuthDir, getSessionAuthPath } from "../shared/session-auth.js";

type JsonObject = Record<string, unknown>;

/** Compute centralized auth path — must match getSessionAuthPath() in cli-launcher.ts */
function centralAuthPath(cwd: string, home: string, serverId = "test-server-id"): string {
  return getSessionAuthPath(cwd, serverId, home);
}

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
  cwd = process.cwd(),
  stdin?: string,
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

  if (stdin !== undefined) {
    child.stdin?.end(stdin);
  } else {
    child.stdin?.end();
  }

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

describe("takode info", () => {
  function createInfoServer(sessionPayload: JsonObject) {
    return createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-info", isOrchestrator: true }));
        return;
      }

      if (method === "GET" && url === `/api/sessions/${String(sessionPayload.sessionId)}/info`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(sessionPayload));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  }

  it("prints codex metadata from the enriched session info shape", async () => {
    const server = createInfoServer({
      sessionId: "worker-info",
      sessionNum: 52,
      name: "Info Worker",
      state: "running",
      backendType: "codex",
      model: "gpt-5.4",
      cwd: "/tmp/info-worker",
      createdAt: Date.now(),
      cliConnected: true,
      isGenerating: false,
      permissionMode: "bypassPermissions",
      askPermission: false,
      isWorktree: true,
      branch: "jiayi",
      actualBranch: "jiayi-wt-7173",
      pendingTimerCount: 3,
      codexReasoningEffort: "high",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
      codexInternetAccess: true,
      codexSandbox: "danger-full-access",
      codexPendingDelivery: {
        pendingInputCount: 2,
        pendingTurnCount: 1,
        oldestPendingAgeMs: 65_000,
        currentTurnId: "turn-active",
        backendState: "connected",
        adapterConnected: true,
        isGenerating: false,
        blockerReason: "active_turn_id_present",
        head: {
          type: "codex_start_pending",
          status: "backend_acknowledged",
          turnId: "turn-head",
          turnTarget: "current",
          dispatchCount: 1,
          pendingInputCount: 1,
        },
      },
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(["info", "worker-info", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-info",
      COMPANION_AUTH_TOKEN: "auth-info",
    });

    server.close();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Backend        codex  model: gpt-5.4");
    expect(result.stdout).toContain("Permissions    bypassPermissions");
    expect(result.stdout).toContain("Ask Mode       no-ask");
    expect(result.stdout).toContain("Internet       enabled");
    expect(result.stdout).toContain("Reasoning      high");
    expect(result.stdout).toContain("Sandbox        danger-full-access");
    expect(result.stdout).toContain("Pending Send   blocker=active_turn_id_present");
    expect(result.stdout).toContain("inputs=2 oldest=1m5s");
    expect(result.stdout).toContain("active=turn-active");
    expect(result.stdout).toContain("Worktree       yes");
    expect(result.stdout).toContain("WT Branch      jiayi");
    expect(result.stdout).toContain("Actual Branch  jiayi-wt-7173");
    expect(result.stdout).toContain("Timers         3 pending");
  });

  it("reports requested versus effective Codex reasoning without promoting an unverified Ultra label", async () => {
    const server = createInfoServer({
      sessionId: "worker-effort",
      sessionNum: 53,
      name: "Effort Worker",
      state: "running",
      backendType: "codex",
      model: "gpt-5.6-sol",
      cwd: "/tmp/effort-worker",
      createdAt: Date.now(),
      cliConnected: true,
      isGenerating: false,
      codexReasoningEffort: "ultra",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(["info", "worker-effort", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-info",
      COMPANION_AUTH_TOKEN: "auth-info",
    });
    server.close();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Reasoning      high");
    expect(result.stdout).toContain("Requested      ultra");
  });

  it("labels requested Ultra as unverified when Codex has not reported an effective effort", async () => {
    const server = createInfoServer({
      sessionId: "worker-unverified",
      state: "running",
      backendType: "codex",
      model: "gpt-5.6-sol",
      cwd: "/tmp/unverified-worker",
      createdAt: Date.now(),
      cliConnected: true,
      codexReasoningEffort: "ultra",
      codexEffectiveReasoningEffort: null,
      codexEffectiveReasoningEffortReported: false,
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const result = await runTakode(["info", "worker-unverified", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-info",
      COMPANION_AUTH_TOKEN: "auth-info",
    });
    server.close();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Reasoning      unknown (requested: ultra)");
    expect(result.stdout).not.toContain("Reasoning      ultra");
  });

  it("outputs compact session JSON by default and hides bulky fields", async () => {
    const server = createInfoServer({
      sessionId: "worker-info",
      sessionNum: 52,
      name: "Info Worker",
      state: "running",
      backendType: "codex",
      model: "gpt-5.4",
      cwd: "/tmp/info-worker",
      createdAt: 123,
      cliConnected: true,
      isGenerating: false,
      injectedSystemPrompt: "large injected prompt",
      taskHistory: [{ title: "Investigate output", startedAt: 100 }],
      tools: ["Read", "Bash"],
      mcpServers: [{ name: "slack", status: "connected" }],
      keywords: ["verbose", "cli"],
      codexPendingDelivery: {
        pendingInputCount: 1,
        pendingTurnCount: 1,
        oldestPendingAgeMs: 1_000,
        currentTurnId: "turn-active",
        backendState: "connected",
        adapterConnected: true,
        isGenerating: false,
        blockerReason: "active_turn_id_present",
        head: null,
      },
      codexPendingDeliveryDetails: {
        pendingInputCount: 1,
        pendingTurnCount: 1,
        oldestPendingAgeMs: 1_000,
        currentTurnId: "turn-active",
        backendState: "connected",
        adapterConnected: true,
        isGenerating: false,
        blockerReason: "active_turn_id_present",
        head: null,
        pendingInputIds: ["input-1"],
        headPendingInputIds: [],
        freshTurnRequiredUntilTurnId: null,
        proofSignals: [{ kind: "turn_started", timestamp: 123, turnId: "turn-active" }],
      },
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(["info", "worker-info", "--port", String(port), "--json"], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-info",
      COMPANION_AUTH_TOKEN: "auth-info",
    });

    server.close();

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonObject;
    expect(parsed).toMatchObject({
      sessionId: "worker-info",
      sessionNum: 52,
      backendType: "codex",
      taskHistoryCount: 1,
      toolsCount: 2,
      mcpServerCount: 1,
      keywordCount: 2,
      codexPendingDelivery: {
        blockerReason: "active_turn_id_present",
        currentTurnId: "turn-active",
      },
    });
    expect(parsed).not.toHaveProperty("injectedSystemPrompt");
    expect(parsed).not.toHaveProperty("taskHistory");
    expect(parsed).not.toHaveProperty("tools");
    expect(parsed).not.toHaveProperty("mcpServers");
    expect(parsed).not.toHaveProperty("keywords");
    expect(parsed).not.toHaveProperty("codexPendingDeliveryDetails");
  });

  it("reveals Codex pending-delivery details only when explicitly included", async () => {
    const server = createInfoServer({
      sessionId: "worker-info",
      sessionNum: 52,
      name: "Info Worker",
      state: "running",
      backendType: "codex",
      model: "gpt-5.4",
      cwd: "/tmp/info-worker",
      createdAt: 123,
      cliConnected: true,
      isGenerating: false,
      codexPendingDelivery: {
        pendingInputCount: 1,
        pendingTurnCount: 1,
        oldestPendingAgeMs: 1_000,
        currentTurnId: "turn-active",
        backendState: "connected",
        adapterConnected: true,
        isGenerating: false,
        blockerReason: "active_turn_id_present",
        head: null,
      },
      codexPendingDeliveryDetails: {
        pendingInputCount: 1,
        pendingTurnCount: 1,
        oldestPendingAgeMs: 1_000,
        currentTurnId: "turn-active",
        backendState: "connected",
        adapterConnected: true,
        isGenerating: false,
        blockerReason: "active_turn_id_present",
        head: null,
        pendingInputIds: ["input-1"],
        headPendingInputIds: [],
        freshTurnRequiredUntilTurnId: null,
        proofSignals: [{ kind: "turn_started", timestamp: 123, turnId: "turn-active" }],
      },
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const result = await runTakode(
      ["info", "worker-info", "--port", String(port), "--json", "--include", "codexPendingDeliveryDetails"],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-info",
        COMPANION_AUTH_TOKEN: "auth-info",
      },
    );

    server.close();

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonObject;
    expect(parsed.codexPendingDeliveryDetails).toMatchObject({
      blockerReason: "active_turn_id_present",
      pendingInputIds: ["input-1"],
      proofSignals: [{ kind: "turn_started", timestamp: 123, turnId: "turn-active" }],
    });
  });

  it("reveals opt-in session detail fields in JSON", async () => {
    const server = createInfoServer({
      sessionId: "worker-info",
      sessionNum: 52,
      name: "Info Worker",
      state: "running",
      backendType: "codex",
      cwd: "/tmp/info-worker",
      createdAt: 123,
      cliConnected: true,
      isGenerating: false,
      injectedSystemPrompt: "large injected prompt",
      taskHistory: [{ title: "Investigate output", startedAt: 100 }],
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const included = await runTakode(
      ["info", "worker-info", "--port", String(port), "--json", "--include", "injectedSystemPrompt"],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-info",
        COMPANION_AUTH_TOKEN: "auth-info",
      },
    );
    const detailed = await runTakode(["info", "worker-info", "--port", String(port), "--json", "--details"], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-info",
      COMPANION_AUTH_TOKEN: "auth-info",
    });

    server.close();

    expect(included.status).toBe(0);
    expect(JSON.parse(included.stdout)).toMatchObject({ injectedSystemPrompt: "large injected prompt" });
    expect(JSON.parse(included.stdout)).not.toHaveProperty("taskHistory");

    expect(detailed.status).toBe(0);
    expect(JSON.parse(detailed.stdout)).toMatchObject({
      injectedSystemPrompt: "large injected prompt",
      taskHistory: [{ title: "Investigate output", startedAt: 100 }],
    });
  });
});
