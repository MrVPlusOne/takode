import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createBundleRoutes } from "../server/routes/bundles.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf-8",
  }).trim();
}

async function runTakode(args: string[], cwd: string, port: number) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    cwd,
    env: { ...process.env, COMPANION_SESSION_ID: "worker", COMPANION_AUTH_TOKEN: "token" },
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

/** Serve the real bundle routes, authenticating every caller as session "worker". */
async function startBundleServer(dir: string): Promise<{ server: Server; port: number }> {
  const api = createBundleRoutes(
    {
      authenticateTakodeCaller: () => ({ callerId: "worker", caller: {} }),
      launcher: { getSessionNum: () => 7 },
    } as never,
    dir,
  );
  const app = new Hono().route("/api", api);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const response = await app.fetch(
      new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0);
  await once(server, "listening");
  return { server, port: (server.address() as AddressInfo).port };
}

// A worker on one machine hands its commits to a session on the port target's
// machine. Two clones of one origin stand in for the two machines.
describe("takode bundle", () => {
  let dir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "takode-bundle-"));
    ({ server, port } = await startBundleServer(join(dir, "bundles")));
  });

  afterEach(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("sends a branch's commits and fetches them into another clone", async () => {
    const origin = join(dir, "origin");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git(origin, "commit", "-q", "--allow-empty", "-m", "base");
    const worker = join(dir, "worker");
    const lander = join(dir, "lander");
    git(dir, "clone", "-q", origin, worker);
    git(dir, "clone", "-q", origin, lander);
    git(worker, "checkout", "-q", "-b", "feature");
    await writeFile(join(worker, "a.txt"), "a");
    git(worker, "add", "a.txt");
    git(worker, "commit", "-q", "-m", "Add a");
    git(worker, "commit", "-q", "--allow-empty", "-m", "Second change");
    const tip = git(worker, "rev-parse", "HEAD");

    const sent = await runTakode(["bundle", "send", "--base", "main"], worker, port);
    expect(sent.stderr).toBe("");
    const id = /bundle (b-[0-9a-f]{8})/.exec(sent.stdout)?.[1];
    expect(id).toBeDefined();

    const fetched = await runTakode(["bundle", "fetch", id!], lander, port);
    expect(fetched.stderr).toBe("");
    expect(fetched.stdout).toContain("Fetched 2 commit(s) from #7 on feature");
    expect(git(lander, "rev-parse", `refs/takode/bundles/${id}`)).toBe(tip);
    expect(git(lander, "log", "--format=%s", `main..refs/takode/bundles/${id}`)).toBe("Second change\nAdd a");
  });
});
