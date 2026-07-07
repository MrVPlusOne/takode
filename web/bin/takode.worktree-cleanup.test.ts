import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
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

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
    });
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  fn: (port: number) => Promise<void>,
) {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.listen(0);
  await once(server, "listening");
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function envForPort(port: number): Record<string, string | undefined> {
  return {
    ...process.env,
    TAKODE_API_PORT: String(port),
    COMPANION_SESSION_ID: "leader-1",
    COMPANION_AUTH_TOKEN: "token-1",
  };
}

describe("takode worktree-cleanup", () => {
  it("prints compact archived worktree cleanup candidates", async () => {
    await withServer(
      (req, res) => {
        if (req.method === "GET" && req.url === "/api/takode/me") {
          writeJson(res, 200, { sessionId: "leader-1", isOrchestrator: true });
          return;
        }
        if (req.method === "GET" && req.url === "/api/worktree-cleanup/candidates") {
          writeJson(res, 200, {
            candidates: [
              {
                sessionId: "s1",
                sessionNum: 12,
                name: "Archived Worker",
                archivedAt: 1770000000000,
                repoRoot: "/repo/companion",
                branch: "main",
                actualBranch: "main-wt-1234",
                worktreePath: "/owned/worktrees/companion/main-wt-1234",
                cleanupStatus: "failed",
                cleanupError: "git worktree remove timed out",
                exists: true,
                inUseBy: [],
                retryable: true,
                owned: true,
                ownershipReason: "takode-worktree-root",
                safety: { status: "not_checked", summary: "dirty/ahead safety checked on retry" },
              },
            ],
          });
          return;
        }
        writeJson(res, 404, { error: "not found" });
      },
      async (port) => {
        const result = await runTakode(["worktree-cleanup", "list"], envForPort(port));

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("Archived worktree cleanup candidates: 1");
        expect(result.stdout).toContain("#12 Archived Worker");
        expect(result.stdout).toContain("failed  retryable");
        expect(result.stdout).toContain("path=/owned/worktrees/companion/main-wt-1234");
        expect(result.stdout).toContain("safety=dirty/ahead safety checked on retry");
      },
    );
  });

  it("prints retry refusal details from safety preflight", async () => {
    await withServer(
      async (req, res) => {
        if (req.method === "GET" && req.url === "/api/takode/me") {
          writeJson(res, 200, { sessionId: "leader-1", isOrchestrator: true });
          return;
        }
        if (req.method === "POST" && req.url === "/api/worktree-cleanup/12/retry") {
          await readJson(req);
          writeJson(res, 409, {
            error: "Worktree has uncommitted changes",
            safety: { status: "blocked", summary: "Worktree has uncommitted changes", dirty: true },
            candidate: {
              sessionId: "s1",
              sessionNum: 12,
              name: "Archived Worker",
              archivedAt: null,
              repoRoot: "/repo/companion",
              branch: "main",
              actualBranch: "main-wt-1234",
              worktreePath: "/owned/worktrees/companion/main-wt-1234",
              cleanupStatus: "failed",
              cleanupError: null,
              exists: true,
              inUseBy: [],
              retryable: true,
              owned: true,
              ownershipReason: "takode-worktree-root",
              safety: { status: "not_checked", summary: "dirty/ahead safety checked on retry" },
            },
          });
          return;
        }
        writeJson(res, 404, { error: "not found" });
      },
      async (port) => {
        const result = await runTakode(["worktree-cleanup", "retry", "12"], envForPort(port));

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("Worktree cleanup retry refused for 12: Worktree has uncommitted changes");
        expect(result.stdout).toContain("safety=Worktree has uncommitted changes");
        expect(result.stdout).toContain("#12 Archived Worker");
      },
    );
  });
});
