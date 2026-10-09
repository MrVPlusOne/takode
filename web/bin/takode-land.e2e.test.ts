import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBundleRoutes } from "../server/routes/bundles.js";
import { createLandingQueueRoutes } from "../server/routes/landing-queue.js";
import { createResourceLeaseRoutes } from "../server/routes/resource-leases.js";
import { LandingQueueManager } from "../server/landing-queue-manager.js";
import { LandingQueueStore } from "../server/landing-queue-store.js";
import { ResourceLeaseManager } from "../server/resource-lease-manager.js";
import { ResourceLeaseStore } from "../server/resource-lease-store.js";
import type { LandingEntry } from "../shared/landing-queue.js";
import { git } from "./landing-git.js";

vi.setConfig({ testTimeout: 120_000 });

/**
 * End to end through the real `takode land` CLI processes, the real landing
 * queue, lease and bundle routes and managers, and real Git: workers are
 * worktrees of one base checkout cloned from a bare origin, as on a machine.
 * Only authentication is simplified: the session ID header names the caller.
 */
describe("takode land end to end", () => {
  let root: string;
  let home: string;
  let origin: string;
  let base: string;
  let server: Server;
  let port: number;
  let leases: ResourceLeaseManager;
  let queue: LandingQueueManager;
  const leaseMessages: { session: string; text: string }[] = [];
  const queueMessages: { session: string; text: string }[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "takode-land-e2e-"));
    home = join(root, "home");
    origin = join(root, "origin.git");
    base = join(root, "base");
    leaseMessages.length = 0;
    queueMessages.length = 0;
    await mkdir(join(home, ".companion"), { recursive: true });
    // Machine-level gate environment, as a user would set a package registry override.
    await writeFile(join(home, ".companion", "landing.json"), JSON.stringify({ env: { GATE_MARK: "machine-config" } }));
    await git(root, ["init", "--quiet", "--bare", "-b", "main", origin]);
    await git(root, ["clone", "--quiet", origin, base]);
    await configure(base);
    await writeFile(join(base, "gate.sh"), 'echo "run $GATE_MARK" >> "$GATE_COUNT"\n[ ! -e broken ]\n');
    await mkdir(join(base, ".takode"));
    await writeFile(
      join(base, ".takode", "landing-gate.json"),
      JSON.stringify({ version: 1, steps: [{ name: "check", run: ["sh", "gate.sh"] }] }),
    );
    await git(base, ["add", "."]);
    await git(base, ["commit", "--quiet", "-m", "seed"]);
    await git(base, ["push", "--quiet", "origin", "main"]);

    leases = new ResourceLeaseManager(
      {
        injectUserMessage: (session, text) => {
          leaseMessages.push({ session, text });
          return "sent";
        },
        invalidateSessionNavigation: () => undefined,
      },
      new ResourceLeaseStore("e2e", join(root, "leases")),
    );
    queue = new LandingQueueManager(
      { leases, notify: (session, text) => void queueMessages.push({ session, text }) },
      new LandingQueueStore("e2e", join(root, "queue")),
    );
    const ctx = {
      authenticateTakodeCaller: (c: { req: { header: (name: string) => string | undefined } }) => {
        const callerId = c.req.header("x-companion-session-id") ?? "unknown";
        return { callerId, caller: { sessionId: callerId, isOrchestrator: false } };
      },
      launcher: { getSession: () => undefined, getSessionNum: () => undefined },
      wsBridge: { landingQueue: queue, getSession: () => undefined },
      resourceLeaseManager: leases,
    } as never;
    const app = new Hono()
      .route("/api", createBundleRoutes(ctx, join(root, "bundles")))
      .route("/api", createLandingQueueRoutes(ctx, join(root, "bundles")))
      .route("/api", createResourceLeaseRoutes(ctx));
    server = createServer(async (req, res) => {
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
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.close();
    queue.destroy();
    leases.destroy();
    await rm(root, { recursive: true, force: true });
  });

  async function configure(dir: string) {
    await git(dir, ["config", "user.name", "Fixture"]);
    await git(dir, ["config", "user.email", "fixture@example.invalid"]);
    await git(dir, ["config", "core.hooksPath", join(root, "no-hooks")]);
  }

  /** A worker worktree of the base checkout with one commit on origin/main. */
  async function workerWith(name: string, file: string): Promise<string> {
    const dir = join(root, name);
    await git(base, ["fetch", "--quiet", "origin"]);
    await git(base, ["worktree", "add", "--quiet", "-b", name, dir, "origin/main"]);
    await writeFile(join(dir, file), `${name}\n`);
    await git(dir, ["add", file]);
    await git(dir, ["commit", "--quiet", "-m", `${name} adds ${file}`]);
    return dir;
  }

  async function takode(session: string, cwd: string, ...args: string[]) {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./takode.ts", import.meta.url)), ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        COMPANION_PORT: String(port),
        COMPANION_SESSION_ID: session,
        COMPANION_AUTH_TOKEN: "token",
        GATE_COUNT: join(root, "gate-count"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += String(chunk)));
    child.stderr?.on("data", (chunk) => (out += String(chunk)));
    const [code] = await once(child, "close");
    return { code: code as number, out };
  }

  async function settled(session: string): Promise<LandingEntry> {
    for (let i = 0; i < 300; i++) {
      const entry = await queue.latestEntryFor(session);
      if (entry && (entry.state === "landed" || entry.state === "bounced")) return entry;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Entry of ${session} did not settle`);
  }

  const gateRuns = async () =>
    (await readFile(join(root, "gate-count"), "utf-8").catch(() => "")).split("\n").filter(Boolean).length;

  it("tests, submits, lands in batches and finishes through the real CLI", async () => {
    // Single change, nothing in flight: submit takes the free lease and starts the run itself.
    const solo = await workerWith("solo", "solo.txt");
    expect((await takode("solo", solo, "land", "submit", "--branch", "main")).out).toContain(
      "No passing `takode land test`",
    );
    const tested = await takode("solo", solo, "land", "test", "--branch", "main");
    expect(tested.code).toBe(0);
    expect(tested.out).toContain("PASSED");
    const submitted = await takode("solo", solo, "land", "submit", "--branch", "main");
    expect(submitted.out).toContain("background landing run started");
    const soloEntry = await settled("solo");
    expect(soloEntry.state).toBe("landed");
    // The pre-submit run gated this exact tree, so the landing run reused it.
    expect(await gateRuns()).toBe(1);
    expect(await git(origin, ["rev-parse", "main"])).toBe(soloEntry.pushedTip);

    // Two more changes queue behind a classic porter holding the lease.
    await leases.acquire({ resourceKey: "port:origin:main", callerSessionId: "porter", purpose: "classic port" });
    const first = await workerWith("first", "first.txt");
    const second = await workerWith("second", "second.txt");
    for (const [session, dir] of [
      ["first", first],
      ["second", second],
    ] as const) {
      expect((await takode(session, dir, "land", "test", "--branch", "main")).code).toBe(0);
      expect((await takode(session, dir, "land", "submit", "--branch", "main")).out).toContain("Queued for");
    }
    // A waiting owner cannot start a run while someone else holds the lease.
    expect((await takode("first", first, "land", "run", "--branch", "main")).out).toContain("You do not hold");
    await leases.release("port:origin:main", "porter");
    // Only the first waiting owner is promoted and asked to run the queue.
    expect(leaseMessages.map((message) => message.session)).toEqual(["first"]);
    expect(leaseMessages[0]!.text).toContain("takode land run");
    const runs = await gateRuns();
    expect((await takode("first", first, "land", "run", "--branch", "main")).out).toContain("Started the background");
    const [firstEntry, secondEntry] = [await settled("first"), await settled("second")];
    expect([firstEntry.state, secondEntry.state]).toEqual(["landed", "landed"]);
    // One gate run for the batch of two; "second" was never promoted.
    expect(await gateRuns()).toBe(runs + 1);
    // Both the pre-submit runs and the landing run's gate got the machine's landing environment.
    const gateLines = (await readFile(join(root, "gate-count"), "utf-8")).split("\n").filter(Boolean);
    expect(gateLines.every((line) => line === "run machine-config")).toBe(true);
    expect(leaseMessages).toHaveLength(1);
    expect(secondEntry.pushedTip).toBe(await git(origin, ["rev-parse", "main"]));
    expect((await leases.getStatus("port:origin:main")).leases).toEqual([]);

    const finished = await takode("second", second, "land", "finish", "--branch", "main");
    expect(finished.code).toBe(0);
    expect(finished.out).toContain(`Synced SHAs: ${secondEntry.mapping!.map((commit) => commit.target).join(",")}`);
    expect(await git(second, ["rev-parse", "HEAD"])).toBe(secondEntry.pushedTip);
    expect(queueMessages.find((message) => message.session === "second")!.text).toContain("takode land finish");
  });
});
