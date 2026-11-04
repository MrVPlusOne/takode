import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { formatTrackLine } from "./takode-track.js";

type JsonObject = Record<string, unknown>;

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body ? (JSON.parse(body) as JsonObject) : {}));
  });
}

async function runTakode(args: string[], port: number) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    env: { ...process.env, COMPANION_SESSION_ID: "leader-1", COMPANION_AUTH_TOKEN: "auth" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

const track = {
  name: "fv",
  repo: "yolo",
  branch: "jiayi/fv-evals",
  follows: "main",
  owner: 2957,
  machine: "devbox",
  workers: [],
  status: { behind: 12, lastCommitAt: Date.now() - 3 * 3600_000 },
  repoRoot: "/repo/yolo",
  checkoutPath: "/home/me/.companion/tracks/yolo/fv",
};

/**
 * A fake Takode server for `takode spawn`: a leader on its own worktree branch,
 * one declared track, and a worker the create call returns. It records the
 * create payload and track calls so the tests can check what spawn asked for.
 */
async function withServer(run: (port: number, seen: { creates: JsonObject[]; calls: string[] }) => Promise<void>) {
  const seen = { creates: [] as JsonObject[], calls: [] as string[] };
  const server = createServer(async (req, res) => {
    const url = req.url || "";
    seen.calls.push(`${req.method} ${url}`);
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url === "/api/takode/me") return reply(200, { sessionId: "leader-1", isOrchestrator: true });
    if (url === "/api/sessions/leader-1") {
      return reply(200, {
        sessionId: "leader-1",
        sessionNum: 2957,
        backendType: "claude",
        cwd: "/worktrees/yolo/main-wt-5411",
        isWorktree: true,
        repoRoot: "/repo/yolo",
        branch: "main",
        actualBranch: "main-wt-5411",
      });
    }
    if (url === "/api/takode/tracks/fv") return reply(200, { track });
    if (url === "/api/takode/tracks/fv/pull") return reply(200, {});
    if (url.startsWith("/api/takode/tracks?")) return reply(200, { tracks: [track] });
    if (url === "/api/sessions/create") {
      seen.creates.push(await readJson(req));
      return reply(200, { sessionId: "worker-1" });
    }
    if (url === "/api/sessions/worker-1/info") {
      return reply(200, {
        sessionId: "worker-1",
        sessionNum: 3400,
        name: "Worker",
        state: "running",
        backendType: "claude",
        cwd: "/worktrees/yolo/x",
        createdAt: Date.now(),
        cliConnected: true,
        isGenerating: false,
        isWorktree: true,
        repoRoot: "/repo/yolo",
      });
    }
    reply(404, { error: "not found" });
  });
  server.listen(0);
  await once(server, "listening");
  try {
    await run((server.address() as AddressInfo).port, seen);
  } finally {
    server.close();
  }
}

describe("takode spawn --track", () => {
  it("starts the worker from the track's checkout and makes the track its port target", async () => {
    await withServer(async (port, seen) => {
      const result = await runTakode(["spawn", "--track", "fv"], port);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      // The checkout is brought up to what landed before the worker starts from it.
      expect(seen.calls).toContain("POST /api/takode/tracks/fv/pull");
      expect(seen.creates[0]).toMatchObject({
        cwd: "/home/me/.companion/tracks/yolo/fv",
        useWorktree: true,
        branch: "jiayi/fv-evals",
        worktreePortTarget: {
          repoRoot: "/repo/yolo",
          branch: "jiayi/fv-evals",
          worktreePath: "/home/me/.companion/tracks/yolo/fv",
          track: "fv",
          sourceLabel: "track fv",
        },
      });
      expect(result.stdout).toContain("Track fv: jiayi/fv-evals, 12 behind main, last commit 3h ago");
    });
  });

  it("refuses options that would pick another checkout or machine", async () => {
    await withServer(async (port, seen) => {
      const result = await runTakode(["spawn", "--track", "fv", "--cwd", "/elsewhere"], port);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("drop --cwd");
      expect(seen.creates).toEqual([]);
    });
  });

  it("reminds a leader spawning without --track in a repository that has tracks", async () => {
    await withServer(async (port, seen) => {
      const result = await runTakode(["spawn"], port);
      expect(result.status).toBe(0);
      // The leader's own branch stays the default target.
      expect(seen.creates[0]).toMatchObject({ branch: "main-wt-5411" });
      expect(result.stdout).toContain("this repository has tracks: fv (jiayi/fv-evals)");
    });
  });
});

describe("formatTrackLine", () => {
  it("names the branch, owner, drift and workers on one line", () => {
    const now = Date.now();
    const line = formatTrackLine(
      {
        ...track,
        workers: [{ sessionNum: 3361, questId: "q-3005" }],
        status: { behind: 0, lastCommitAt: now - 5 * 60_000 },
      },
      now,
    );
    expect(line).toBe(
      "fv  yolo:jiayi/fv-evals  owner #2957; up to date with main, last commit 5m ago; workers #3361 q-3005",
    );
    expect(formatTrackLine({ ...track, status: { unavailable: "laptop is offline" } }, now)).toContain(
      "status unknown (laptop is offline)",
    );
  });
});
