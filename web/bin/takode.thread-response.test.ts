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

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
  stdin?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end(stdin ?? "");

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

function responseRecord(options: { threadKey?: string; logicalResponseId?: string; revisionCount?: number } = {}) {
  const threadKey = options.threadKey ?? "q-42";
  const logicalResponseId = options.logicalResponseId ?? "response-secret-1";
  const revisionCount = options.revisionCount ?? 2;
  return {
    version: 1,
    logicalResponseId,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    batchId: "batch-audit-1",
    currentRevisionId: `revision-secret-${revisionCount}`,
    currentMessageId: `response-message-${revisionCount}`,
    currentHistoryIndex: 18,
    revisionCount,
    coveredMessageCount: 2,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    revisions: [
      {
        revisionId: "revision-secret-1",
        revisionNumber: 1,
        messageId: "response-message-1",
        historyIndex: 10,
        markdown: "Earlier response wording.",
        contentHash: "hash-1",
        createdAt: 1_700_000_000_000,
      },
      {
        revisionId: `revision-secret-${revisionCount}`,
        parentRevisionId: "revision-secret-1",
        revisionNumber: revisionCount,
        messageId: `response-message-${revisionCount}`,
        historyIndex: 18,
        markdown: "## Current response\n\nThe polished answer is ready.",
        contentHash: `hash-${revisionCount}`,
        createdAt: 1_700_000_001_000,
      },
    ],
  };
}

function responseState(options: { threadKey?: string; pending?: boolean; responseCount?: number } = {}) {
  const threadKey = options.threadKey ?? "q-42";
  const pending = options.pending ?? true;
  const responseCount = options.responseCount ?? 1;
  return {
    version: 1,
    cutoverHistoryIndex: 5,
    pendingMessageCount: pending ? 3 : 0,
    pendingBatches: pending
      ? [
          {
            token: "opaque-batch-token-1",
            messageCount: 2,
            firstAskedAt: 1_700_000_002_000,
            lastAskedAt: 1_700_000_002_500,
            previews: [
              {
                preview: "Please investigate the failure and preserve the evidence.",
                truncated: false,
                imageCount: 1,
                timestamp: 1_700_000_002_000,
              },
              {
                preview: "Also include the mobile path",
                truncated: true,
                imageCount: 0,
                timestamp: 1_700_000_002_500,
              },
            ],
          },
          {
            token: "opaque-batch-token-2",
            messageCount: 1,
            firstAskedAt: 1_700_000_003_000,
            lastAskedAt: 1_700_000_003_000,
            previews: [
              {
                preview: "A later request remains separate.",
                truncated: false,
                imageCount: 0,
                timestamp: 1_700_000_003_000,
              },
            ],
          },
        ]
      : [],
    responses: Array.from({ length: responseCount }, (_, index) =>
      responseRecord({ threadKey, logicalResponseId: `response-secret-${index + 1}` }),
    ),
    ready: !pending,
  };
}

function getPayload(threadKey = "q-42", state = responseState({ threadKey })) {
  return { sessionId: "leader-response", threadKey, responseState: state };
}

function leaderEnv(port: number) {
  return {
    ...process.env,
    COMPANION_SESSION_ID: "leader-response",
    COMPANION_AUTH_TOKEN: "response-token",
    COMPANION_PORT: String(port),
  };
}

function handleLeaderMe(req: IncomingMessage, res: import("node:http").ServerResponse): boolean {
  if (req.method !== "GET" || req.url !== "/api/takode/me") return false;
  const sessionId = String(req.headers["x-companion-session-id"] ?? "");
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ sessionId, isOrchestrator: sessionId === "leader-response" }));
  return true;
}

describe("takode thread-response", () => {
  it("shows pending batch previews and current responses without normal-mode audit identifiers", async () => {
    const requestUrls: string[] = [];
    const server = createServer((req, res) => {
      requestUrls.push(req.url || "");
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/main") {
        expect(req.headers["x-companion-session-id"]).toBe("leader-response");
        expect(req.headers["x-companion-auth-token"]).toBe("response-token");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload("main", responseState({ threadKey: "main" }))));
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
        ["thread-response", "show", "--thread", "main", "--port", String(port)],
        leaderEnv(port),
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Main thread responses");
      expect(result.stdout).toContain("Pending: 3 messages in 2 batches");
      expect(result.stdout).toContain("Please investigate the failure");
      expect(result.stdout).toContain("1 image");
      expect(result.stdout).toContain("Current responses: 1");
      expect(result.stdout).toContain("The polished answer is ready.");
      expect(result.stdout).not.toContain("opaque-batch-token");
      expect(result.stdout).not.toContain("response-secret");
      expect(result.stdout).not.toContain("revision-secret");
      expect(result.stdout).not.toContain("Earlier response wording.");
      expect(requestUrls).toEqual(["/api/takode/me", "/api/sessions/leader-response/thread-responses/main"]);
    } finally {
      server.close();
    }
  });

  it("reveals batch, response, revision, and full-body audit details only through --history", async () => {
    const server = createServer((req, res) => {
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload()));
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
        ["thread-response", "show", "--thread", "q-42", "--history", "--port", String(port)],
        leaderEnv(port),
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Audit: cutover history 5");
      expect(result.stdout).toContain("Pending batch 1: opaque-batch-token-1");
      expect(result.stdout).toContain("Response 1: response-secret-1 · batch batch-audit-1");
      expect(result.stdout).toContain("revision-secret-1 · message response-message-1 · history 10");
      expect(result.stdout).toContain("Earlier response wording.");
    } finally {
      server.close();
    }
  });

  it("creates a response for the oldest opaque pending batch without absorbing a later batch", async () => {
    const seenBodies: JsonObject[] = [];
    const observedState = responseState();
    const createdResponse = responseRecord({ logicalResponseId: "created-response", revisionCount: 1 });
    createdResponse.currentRevisionId = "created-revision-1";
    createdResponse.currentMessageId = "created-message-1";
    createdResponse.coveredMessageCount = 2;
    createdResponse.revisionCount = 1;
    createdResponse.revisions = [
      {
        revisionId: "created-revision-1",
        revisionNumber: 1,
        messageId: "created-message-1",
        historyIndex: 25,
        markdown: "Fresh **leader** response with $HOME and `code`.\n",
        contentHash: "created-hash",
        createdAt: 1_700_000_004_000,
      },
    ];
    const remainingState = responseState();
    remainingState.pendingMessageCount = 1;
    remainingState.pendingBatches = [remainingState.pendingBatches[1]!];
    remainingState.responses = [...remainingState.responses, createdResponse];

    const server = createServer(async (req, res) => {
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload("q-42", observedState)));
        return;
      }
      if (req.method === "PUT" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "leader-response",
            threadKey: "q-42",
            response: createdResponse,
            responseState: remainingState,
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
    const markdown = "Fresh **leader** response with $HOME and `code`.\n";

    try {
      const result = await runTakode(
        ["thread-response", "set", "--thread", "q-42", "--text-file", "-", "--port", String(port)],
        leaderEnv(port),
        markdown,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(seenBodies).toEqual([
        {
          intent: "create",
          pendingBatchToken: "opaque-batch-token-1",
          baseRevisionId: null,
          markdown,
          idempotencyKey: expect.stringMatching(/^thread-response-cli:[0-9a-f]{64}$/),
        },
      ]);
      expect(result.stdout).toContain("Created q-42 response for 2 messages (revision 1); 1 pending");
      expect(result.stdout).not.toContain("opaque-batch-token");
      expect(result.stdout).not.toContain(markdown.trim());
    } finally {
      server.close();
    }
  });

  it("revises the latest logical response when no user batch is pending", async () => {
    const seenBodies: JsonObject[] = [];
    const observedState = responseState({ pending: false, responseCount: 2 });
    const revisedResponse = responseRecord({ logicalResponseId: "response-secret-2", revisionCount: 3 });
    const revisedState = responseState({ pending: false, responseCount: 2 });
    revisedState.responses[1] = revisedResponse;

    const server = createServer(async (req, res) => {
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload("q-42", observedState)));
        return;
      }
      if (req.method === "PUT" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId: "leader-response",
            threadKey: "q-42",
            response: revisedResponse,
            responseState: revisedState,
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
        ["thread-response", "set", "--thread", "q-42", "--text-file", "-", "--port", String(port)],
        leaderEnv(port),
        "Refined final wording.",
      );

      expect(result.status).toBe(0);
      expect(seenBodies).toEqual([
        {
          intent: "revise",
          responseId: "response-secret-2",
          baseRevisionId: "revision-secret-2",
          markdown: "Refined final wording.",
          idempotencyKey: expect.stringMatching(/^thread-response-cli:[0-9a-f]{64}$/),
        },
      ]);
      expect(result.stdout).toContain("Revised q-42 response for 2 messages (revision 3); 0 pending");
      expect(result.stdout).not.toContain("response-secret-2");
    } finally {
      server.close();
    }
  });

  it("keeps default JSON compact and reveals tokens and revision bodies only with --history", async () => {
    const server = createServer((req, res) => {
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload()));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const compact = await runTakode(
        ["thread-response", "show", "--thread", "q-42", "--json", "--port", String(port)],
        leaderEnv(port),
      );
      const detailed = await runTakode(
        ["thread-response", "show", "--thread", "q-42", "--history", "--json", "--port", String(port)],
        leaderEnv(port),
      );

      expect(compact.status).toBe(0);
      const compactState = JSON.parse(compact.stdout).responseState;
      expect(compactState.pendingBatches[0].token).toBeUndefined();
      expect(compactState.responses[0].logicalResponseId).toBeUndefined();
      expect(compactState.responses[0].revisions).toBeUndefined();
      expect(compactState.responses[0].preview).toContain("Current response");
      const detailedState = JSON.parse(detailed.stdout).responseState;
      expect(detailedState.pendingBatches[0].token).toBe("opaque-batch-token-1");
      expect(detailedState.responses[0].revisions).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it("reports stale server state with rerun guidance instead of guessing a new batch", async () => {
    const server = createServer(async (req, res) => {
      if (handleLeaderMe(req, res)) return;
      if (req.method === "GET" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(getPayload()));
        return;
      }
      if (req.method === "PUT" && req.url === "/api/sessions/leader-response/thread-responses/q-42") {
        await readJson(req);
        const refreshed = responseState();
        refreshed.pendingMessageCount = 1;
        refreshed.pendingBatches = [refreshed.pendingBatches[1]!];
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Pending batch changed.", responseState: refreshed }));
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
        ["thread-response", "set", "--thread", "q-42", "--text-file", "-", "--port", String(port)],
        leaderEnv(port),
        "Do not guess coverage.",
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Pending batch changed.");
      expect(result.stderr).toContain("Pending messages now: 1.");
      expect(result.stderr).toContain("Rerun set so Takode can use the latest server-owned response state.");
    } finally {
      server.close();
    }
  });

  it("exposes focused help and rejects normal workers before reading response state", async () => {
    const help = await runTakode(["help", "thread-response"], { ...process.env });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("takode thread-response show --thread <main|q-N>");
    expect(help.stdout).toContain("automatically creates a response for the oldest server-owned pending batch");
    expect(help.stdout).toContain("command itself is the user-visible routed response");

    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-response", isOrchestrator: false }));
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected request" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const worker = await runTakode(["thread-response", "show", "--thread", "q-42", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-response",
        COMPANION_AUTH_TOKEN: "worker-token",
        COMPANION_PORT: String(port),
      });

      expect(worker.status).toBe(1);
      expect(worker.stderr).toContain("takode commands require an orchestrator session.");
    } finally {
      server.close();
    }
  });
});
