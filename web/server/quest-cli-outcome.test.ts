import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

type SeenRequest = {
  method?: string;
  url?: string;
  sessionId?: string | string[];
  authToken?: string | string[];
  contentType?: string | string[];
  body: JsonObject;
};

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body ? (JSON.parse(body) as JsonObject) : {}));
  });
}

function captureRequest(req: IncomingMessage): Promise<SeenRequest> {
  return readJson(req).then((body) => ({
    method: req.method,
    url: req.url,
    sessionId: req.headers["x-companion-session-id"],
    authToken: req.headers["x-companion-auth-token"],
    contentType: req.headers["content-type"],
    body,
  }));
}

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR:
        env.BUN_INSTALL_CACHE_DIR ||
        process.env.BUN_INSTALL_CACHE_DIR ||
        join(process.env.HOME || "", ".bun/install/cache"),
    },
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

function baseEnv(home: string, port?: number): Record<string, string | undefined> {
  return {
    ...process.env,
    COMPANION_PORT: port === undefined ? undefined : String(port),
    COMPANION_SESSION_ID: port === undefined ? undefined : "leader-session",
    COMPANION_AUTH_TOKEN: port === undefined ? undefined : "outcome-token",
    HOME: home,
  };
}

function revision(
  revisionId: string,
  markdown: string,
  summaryMarkdown: string,
  options: { parentRevisionId?: string; historyIndex?: number; messageId?: string } = {},
) {
  return {
    revisionId,
    ...(options.parentRevisionId ? { parentRevisionId: options.parentRevisionId } : {}),
    markdown,
    summaryMarkdown,
    summarySource: "authored",
    contentHash: `hash-${revisionId}`,
    createdAt: Number(revisionId.replace(/\D/g, "")) || 1,
    actor: { kind: "leader", sessionId: "leader-session" },
    ...(options.historyIndex !== undefined
      ? {
          anchor: {
            sessionId: "leader-session",
            historyIndex: options.historyIndex,
            ...(options.messageId ? { messageId: options.messageId } : {}),
          },
        }
      : {}),
    sources: [{ kind: "manual", targetQuestId: "q-test", contentHash: `source-${revisionId}` }],
  };
}

function seedLiveQuest(home: string, quest: JsonObject): void {
  const liveDir = join(home, ".companion", "questmaster-live");
  mkdirSync(liveDir, { recursive: true });
  writeFileSync(
    join(liveDir, "store.json"),
    JSON.stringify(
      {
        format: "mutable_current_record",
        version: 1,
        nextQuestNumber: 100,
        updatedAt: 1,
        quests: [quest],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

describe("quest outcome CLI", () => {
  it("shows the current local Outcome version and its exact boundary", async () => {
    // Read-only show stays local while still exposing the current immutable revision clearly.
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-outcome-show-"));
    const first = revision("r1", "First result.", "First result.");
    const second = revision("r2", "## Delivered\n\nCurrent result.", "Current result.", {
      parentRevisionId: "r1",
      historyIndex: 12,
      messageId: "assistant-12",
    });
    seedLiveQuest(tmp, {
      id: "q-7",
      questId: "q-7",
      version: 1,
      title: "Show outcome",
      description: "Exercise the current Outcome CLI.",
      status: "in_progress",
      sessionId: "worker-7",
      claimedAt: 1,
      createdAt: 1,
      statusChangedAt: 1,
      outcome: { currentRevisionId: "r2", revisions: [first, second] },
    });

    try {
      const result = await runQuest(["outcome", "show", "q-7"], baseEnv(tmp), tmp);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("q-7 Current Outcome (version 2/2, r2)");
      expect(result.stdout).toContain("Summary: Current result.");
      expect(result.stdout).toContain("Boundary: leader-session history 12");
      expect(result.stdout).toContain("## Delivered\n\nCurrent result.");
      expect(result.stdout).not.toContain("First result.");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses set inputs and sends an authenticated CAS update with compact plain output", async () => {
    // This guards file-safe Markdown input, authored summaries, base overrides, and explicit boundary advancement.
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-outcome-set-"));
    const markdownPath = join(tmp, "outcome.md");
    const summaryPath = join(tmp, "outcome-summary.md");
    const markdown = "## Delivered\n\nThe first coherent version is ready.";
    const summaryMarkdown = "The first coherent version is ready.";
    writeFileSync(markdownPath, markdown, "utf-8");
    writeFileSync(summaryPath, summaryMarkdown, "utf-8");

    const current = {
      currentRevisionId: "r1",
      revisions: [revision("r1", "Earlier result.", "Earlier result.")],
    };
    const updated = {
      currentRevisionId: "r2",
      revisions: [
        current.revisions[0],
        revision("r2", markdown, summaryMarkdown, {
          parentRevisionId: "r1",
          historyIndex: 18,
        }),
      ],
    };
    const seen: SeenRequest[] = [];
    const server = createServer(async (req, res) => {
      seen.push(await captureRequest(req));
      res.writeHead(200, { "content-type": "application/json" });
      if (req.method === "GET" && req.url === "/api/quests/q-8/outcome") {
        res.end(JSON.stringify({ questId: "q-8", outcome: current }));
        return;
      }
      if (req.method === "PUT" && req.url === "/api/quests/q-8/outcome") {
        res.end(JSON.stringify({ quest: { questId: "q-8" }, outcome: updated }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runQuest(
        [
          "outcome",
          "set",
          "q-8",
          "--text-file",
          markdownPath,
          "--summary-file",
          summaryPath,
          "--base",
          "r0",
          "--advance-through",
          "leader-session",
        ],
        baseEnv(tmp, port),
        tmp,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(seen).toHaveLength(2);
      expect(seen[0]).toMatchObject({
        method: "GET",
        url: "/api/quests/q-8/outcome",
        sessionId: "leader-session",
        authToken: "outcome-token",
        body: {},
      });
      expect(seen[1]).toMatchObject({
        method: "PUT",
        url: "/api/quests/q-8/outcome",
        sessionId: "leader-session",
        authToken: "outcome-token",
        contentType: "application/json",
        body: {
          baseRevisionId: "r0",
          markdown,
          summaryMarkdown,
          advanceThroughSessionId: "leader-session",
          idempotencyKey: expect.stringMatching(/^set:q-8:[0-9a-f-]{36}$/),
        },
      });
      expect(result.stdout).toContain("q-8 Current Outcome (version 2/2, r2)");
      expect(result.stdout).toContain(`Summary: ${summaryMarkdown}`);
      expect(result.stdout).toContain("Boundary: leader-session history 18");
      expect(result.stdout).toContain(markdown);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses use source flags and sends an authenticated append request with JSON output", async () => {
    // Exact source identity and deterministic retry keys make message reuse auditable and idempotent.
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-outcome-use-"));
    const current = {
      currentRevisionId: "r2",
      revisions: [revision("r2", "Existing result.", "Existing result.")],
    };
    const appendedMarkdown = "Existing result.\n\nAdditional accepted detail.";
    const updated = {
      currentRevisionId: "r3",
      revisions: [
        current.revisions[0],
        revision("r3", appendedMarkdown, "Existing result with accepted detail.", {
          parentRevisionId: "r2",
          historyIndex: 27,
          messageId: "assistant-27",
        }),
      ],
    };
    const seen: SeenRequest[] = [];
    const server = createServer(async (req, res) => {
      seen.push(await captureRequest(req));
      res.writeHead(200, { "content-type": "application/json" });
      if (req.method === "GET" && req.url === "/api/quests/q-9/outcome") {
        res.end(JSON.stringify({ questId: "q-9", outcome: current }));
        return;
      }
      if (req.method === "PUT" && req.url === "/api/quests/q-9/outcome") {
        res.end(JSON.stringify({ quest: { questId: "q-9" }, outcome: updated }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runQuest(
        [
          "outcome",
          "use",
          "q-9",
          "--session",
          "leader-9",
          "--message",
          "assistant-27",
          "--history-index",
          "27",
          "--append",
          "--base",
          "r2",
          "--json",
        ],
        baseEnv(tmp, port),
        tmp,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(seen).toHaveLength(2);
      expect(seen[0]).toMatchObject({
        method: "GET",
        url: "/api/quests/q-9/outcome",
        sessionId: "leader-session",
        authToken: "outcome-token",
        body: {},
      });
      expect(seen[1]).toMatchObject({
        method: "PUT",
        url: "/api/quests/q-9/outcome",
        sessionId: "leader-session",
        authToken: "outcome-token",
        contentType: "application/json",
        body: {
          baseRevisionId: "r2",
          mode: "append",
          source: { sessionId: "leader-9", messageId: "assistant-27", historyIndex: 27 },
          idempotencyKey: "append:q-9:leader-9:assistant-27:r2",
        },
      });
      expect(JSON.parse(result.stdout)).toEqual({ questId: "q-9", outcome: updated });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
