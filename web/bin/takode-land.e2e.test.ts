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
import { LandingGateStore } from "../server/landing-gate-store.js";
import { LandingQueueStore } from "../server/landing-queue-store.js";
import { ResourceLeaseManager } from "../server/resource-lease-manager.js";
import { ResourceLeaseStore } from "../server/resource-lease-store.js";
import type { LandingEntry } from "../shared/landing-queue.js";
import { git } from "./landing-git.js";

vi.setConfig({ testTimeout: 120_000 });

const TAKODE = fileURLToPath(new URL("./takode.ts", import.meta.url));

/**
 * A stand-in for Vitest: records the test paths it was given in $VITEST_ARGS and
 * writes a passing Vitest-shaped report for them (every *.test.ts under tests/
 * when none are given) to --outputFile.
 */
const FAKE_VITEST = `
import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const output = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const files = args.filter((a) => !a.startsWith("-"));
appendFileSync(process.env.VITEST_ARGS, JSON.stringify(files) + "\\n");
const run = files.length ? files : readdirSync("tests").map((name) => join("tests", name));
const testResults = run.map((file) => ({ name: join(process.cwd(), file), status: "passed", assertionResults: [{ fullName: "ok", status: "passed" }] }));
writeFileSync(output, JSON.stringify({ testResults }));
`;

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
  /** When set, the server cannot start runners (a host offline), with this reason. */
  let launchFailure: string | null;
  let launchCount: number;
  const runnerLogs: (() => string)[] = [];
  const runners: ReturnType<typeof spawn>[] = [];
  const leaseMessages: { session: string; text: string }[] = [];
  const queueMessages: { session: string; text: string }[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "takode-land-e2e-"));
    home = join(root, "home");
    origin = join(root, "origin.git");
    base = join(root, "base");
    leaseMessages.length = 0;
    queueMessages.length = 0;
    await mkdir(home);
    await git(root, ["init", "--quiet", "--bare", "-b", "main", origin]);
    await git(root, ["clone", "--quiet", origin, base]);
    await configure(base);
    await writeFile(join(base, "gate.sh"), 'echo run >> "$GATE_COUNT"\n[ ! -e broken ]\n');
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
    launchFailure = null;
    launchCount = 0;
    queue = new LandingQueueManager(
      {
        leases,
        notify: (session, text) => void queueMessages.push({ session, text }),
        // The server starts runners as `takode land run --foreground` with the runner's own
        // credentials, as startLandingRunner does, here with the test's HOME and port.
        launchRunner: async (request) => {
          if (launchFailure) throw new Error(launchFailure);
          launchCount++;
          const child = spawn(
            process.execPath,
            [TAKODE, "land", "run", "--foreground", "--branch", request.target.branch],
            {
              cwd: request.baseCheckout,
              env: runnerEnv(request.sessionId, request.token),
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let log = "";
          child.stdout?.on("data", (chunk) => (log += String(chunk)));
          child.stderr?.on("data", (chunk) => (log += String(chunk)));
          runnerLogs.push(() => log);
          runners.push(child);
          child.once("exit", (code) => void queue.runnerExited(request.launchId, `exit code ${code}`));
        },
      },
      new LandingQueueStore("e2e", join(root, "queue")),
      new LandingGateStore("e2e", join(root, "gates")),
    );
    await queue.start();
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
    // Stop runners still going and let the queue record their exits before the directory goes.
    for (const child of runners.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await queue.snapshot({ repo: "origin", branch: "main" });
    runnerLogs.length = 0;
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
    return takodeOn(port, session, cwd, ...args);
  }

  function runnerEnv(session: string, token: string, serverPort = port): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      COMPANION_PORT: String(serverPort),
      COMPANION_SESSION_ID: session,
      COMPANION_AUTH_TOKEN: token,
      GATE_COUNT: join(root, "gate-count"),
      VITEST_ARGS: join(root, "vitest-args"),
    };
    delete env.TAKODE_API_PORT;
    return env;
  }

  async function takodeOn(serverPort: number, session: string, cwd: string, ...args: string[]) {
    const child = spawn(process.execPath, [TAKODE, ...args], {
      cwd,
      env: runnerEnv(session, "token", serverPort),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += String(chunk)));
    child.stderr?.on("data", (chunk) => (out += String(chunk)));
    const [code] = await once(child, "close");
    return { code: code as number, out };
  }

  async function latestEntry(session: string): Promise<LandingEntry | undefined> {
    return (await queue.snapshot({ repo: "origin", branch: "main" })).entries
      .filter((entry) => entry.sessionId === session)
      .at(-1);
  }

  async function settled(session: string): Promise<LandingEntry> {
    for (let i = 0; i < 300; i++) {
      const entry = await latestEntry(session);
      if (entry && (entry.state === "landed" || entry.state === "bounced")) return entry;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      `Entry of ${session} did not settle. Runner logs:\n${runnerLogs.map((log) => log()).join("\n---\n")}`,
    );
  }

  /** The test paths each fake Vitest run was given, in order. */
  const vitestArgs = async () =>
    (await readFile(join(root, "vitest-args"), "utf-8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);

  const gateRuns = async () =>
    (await readFile(join(root, "gate-count"), "utf-8").catch(() => "")).split("\n").filter(Boolean).length;

  /** The gate the repository branch opts in with, saved on the server through the CLI. */
  async function saveGate(cwd: string) {
    const draft = join(root, "gate.json");
    await writeFile(draft, JSON.stringify({ version: 1, steps: [{ name: "check", run: ["sh", "gate.sh"] }] }));
    const saved = await takode("solo", cwd, "land", "gate", "save", draft, "--branch", "main");
    expect(saved.out).toContain("Saved the landing gate for origin:main: 1 step(s) (check)");
  }

  it("frees the full-suite slot and stops the gate when a pre-submit run is stopped", async () => {
    // A stopped `takode land test` (Ctrl-C, a killed tool call) used to leave its
    // full-suite:<repo> slot held, blocking every later run on the machine.
    const worker = await workerWith("stopper", "stopper.txt");
    await writeFile(join(worker, "slow.sh"), 'echo $$ > "$GATE_PID"\nsleep 60\n');
    await git(worker, ["add", "slow.sh"]);
    await git(worker, ["commit", "--quiet", "-m", "slow gate step"]);
    const draft = join(root, "slow-gate.json");
    await writeFile(draft, JSON.stringify({ version: 1, steps: [{ name: "slow", run: ["sh", "slow.sh"] }] }));
    await takode("stopper", worker, "land", "gate", "save", draft, "--branch", "main");

    const pidFile = join(root, "gate.pid");
    const child = spawn(process.execPath, [TAKODE, "land", "test", "--full", "--branch", "main"], {
      cwd: worker,
      env: {
        ...process.env,
        HOME: home,
        COMPANION_PORT: String(port),
        COMPANION_SESSION_ID: "stopper",
        COMPANION_AUTH_TOKEN: "token",
        GATE_PID: pidFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += String(chunk)));
    child.stderr?.on("data", (chunk) => (out += String(chunk)));
    let gatePid = 0;
    for (let i = 0; i < 100 && !gatePid; i++) {
      gatePid = Number(await readFile(pidFile, "utf-8").catch(() => "0"));
      if (!gatePid) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(gatePid, out).toBeGreaterThan(0);
    expect((await leases.getStatus("full-suite:origin")).leases.map((lease) => lease.ownerSessionId)).toEqual([
      "stopper",
    ]);

    child.kill("SIGTERM");
    const [code] = await once(child, "close");
    expect(code, out).toBe(143);
    expect(out).toContain("releasing full-suite:origin");
    expect((await leases.getStatus("full-suite:origin")).leases).toEqual([]);
    // The gate command's process group was stopped too, so no test run keeps going without a slot.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(gatePid, 0)).toThrow();
  });

  it("tests and submits through the real CLI, and the server's runners land the changes in batches", async () => {
    // Single change, nothing in flight: the server takes the free lease and starts a runner itself.
    const solo = await workerWith("solo", "solo.txt");
    await saveGate(solo);
    expect((await takode("solo", solo, "land", "submit", "--branch", "main")).out).toContain(
      "No passing `takode land test`",
    );
    const tested = await takode("solo", solo, "land", "test", "--full", "--branch", "main");
    expect(tested.code).toBe(0);
    expect(tested.out).toContain("PASSED: full gate");
    const submitted = await takode("solo", solo, "land", "submit", "--branch", "main");
    expect(submitted.code, submitted.out).toBe(0);
    expect(submitted.out).toContain("Takode starts a landing run for it now.");
    expect(submitted.out).toContain("You don't wait for it");
    const soloEntry = await settled("solo");
    expect(soloEntry.state).toBe("landed");
    // The full pre-submit run gated this exact tree, so the landing run reused it.
    expect(await gateRuns()).toBe(1);
    expect(await git(origin, ["rev-parse", "main"])).toBe(soloEntry.pushedTip);

    // Two more changes wait behind a classic porter holding the lease; nobody has to run anything.
    await leases.acquire({ resourceKey: "port:origin:main", callerSessionId: "porter", purpose: "classic port" });
    const first = await workerWith("first", "first.txt");
    const second = await workerWith("second", "second.txt");
    for (const [session, dir] of [
      ["first", first],
      ["second", second],
    ] as const) {
      expect((await takode(session, dir, "land", "test", "--full", "--branch", "main")).code).toBe(0);
      expect((await takode(session, dir, "land", "submit", "--branch", "main")).code).toBe(0);
    }
    const waiting = await takode("first", first, "land", "status", "--branch", "main");
    expect(waiting.out).toContain("waiting for port:origin:main (a classic port holds it)");
    const launchesBefore = launchCount;
    const runs = await gateRuns();
    await leases.release("port:origin:main", "porter");
    const [firstEntry, secondEntry] = [await settled("first"), await settled("second")];
    expect([firstEntry.state, secondEntry.state]).toEqual(["landed", "landed"]);
    // One runner and one gate run for the batch of two.
    expect(launchCount).toBe(launchesBefore + 1);
    expect(await gateRuns()).toBe(runs + 1);
    expect(secondEntry.pushedTip).toBe(await git(origin, ["rev-parse", "main"]));
    await vi.waitFor(async () => expect((await leases.getStatus("port:origin:main")).leases).toEqual([]));
    // No session was ever promoted on the port lease or asked to run or finish anything.
    expect(leaseMessages).toEqual([]);
    await vi.waitFor(() =>
      expect(queueMessages.map((message) => message.session).sort()).toEqual(["first", "second", "solo"]),
    );
    expect(queueMessages.find((message) => message.session === "second")!.text).not.toContain("land finish");
    // An agent session cannot act as a runner: runs are claimed only with a runner's own credentials.
    const asSession = await fetch(`http://localhost:${port}/api/takode/land/runs`, {
      method: "POST",
      headers: { "x-companion-session-id": "solo", "x-companion-auth-token": "token" },
      body: JSON.stringify({ target: { repo: "origin", branch: "main" } }),
    });
    expect(asSession.status).toBe(403);
  });

  it("starts a runner by hand when the server cannot, and resumes a bounced change in another worktree", async () => {
    const owner = await workerWith("owner", "owner.txt");
    await saveGate(owner);
    // The change breaks the gate: the runner bounces it with the failing output.
    await writeFile(join(owner, "broken"), "");
    await git(owner, ["add", "broken"]);
    await git(owner, ["commit", "--quiet", "-m", "break the gate"]);
    launchFailure = "the host is offline";
    expect((await takode("owner", owner, "land", "submit", "--skip-test", "fixture", "--branch", "main")).code).toBe(0);
    await vi.waitFor(async () =>
      expect((await takode("owner", owner, "land", "status", "--branch", "main")).out).toContain(
        "problem: The landing runner could not start",
      ),
    );
    // A session with nothing waiting cannot start runners; the owner of the waiting change can.
    const stranger = await workerWith("stranger", "stranger.txt");
    expect((await takode("stranger", stranger, "land", "run", "--branch", "main")).out).toContain(
      "Only a leader or the owner of a waiting change",
    );
    const byHand = await takode("owner", owner, "land", "run", "--branch", "main");
    expect(byHand.code, byHand.out).toBe(0);
    expect(byHand.out).toContain("Started landing runner");
    const entry = await settled("owner");
    expect(entry.state).toBe("bounced");
    expect(entry.reason).toContain("The landing gate failed (check)");
    await vi.waitFor(() =>
      expect(queueMessages.find((message) => message.session === "owner")?.text).toContain(
        `takode land resume ${entry.id}`,
      ),
    );

    // Another worker restores exactly the submitted change from the queue's bundle.
    const fixer = join(root, "fixer");
    await git(base, ["worktree", "add", "--quiet", "-b", "fixer", fixer, "origin/main"]);
    const resumed = await takode("fixer", fixer, "land", "resume", entry.id, "--branch", "main");
    expect(resumed.code, resumed.out).toBe(0);
    expect(resumed.out).toContain("It bounced: The landing gate failed (check).");
    expect(await git(fixer, ["rev-parse", "HEAD"])).toBe(entry.tip);
  });

  it("runs a focused pre-submit check of chosen tests, which the landing queue never reuses", async () => {
    // The worker names the tests its change needs; the gate's other steps run whole,
    // no full-suite slot is taken, and the queue still runs the full gate on the batch.
    const worker = await workerWith("focus", "focus.txt");
    await writeFile(join(worker, "fake-vitest.mjs"), FAKE_VITEST);
    await mkdir(join(worker, "tests"));
    await writeFile(join(worker, "tests", "a.test.ts"), "");
    await git(worker, ["add", "."]);
    await git(worker, ["commit", "--quiet", "-m", "tests"]);
    const draft = join(root, "vitest-gate.json");
    await writeFile(
      draft,
      JSON.stringify({
        version: 1,
        steps: [
          { name: "check", run: ["sh", "gate.sh"] },
          { name: "tests", kind: "vitest", run: [process.execPath, "fake-vitest.mjs"] },
        ],
      }),
    );
    await takode("focus", worker, "land", "gate", "save", draft, "--branch", "main");
    const land = (...args: string[]) => takode("focus", worker, "land", ...args, "--branch", "main");

    const unchosen = await land("test");
    expect(unchosen.code).toBe(1);
    expect(unchosen.out).toContain("Choose what `takode land test` runs");
    expect(unchosen.out).toContain("the gate's other steps (check) plus only these tests in its test step (tests)");
    expect((await land("test", "tests/missing.test.ts")).out).toContain("tests/missing.test.ts does not exist");
    expect((await land("test", "..")).out).toContain("is not under the directory of the gate's test step (.)");

    const tested = await land("test", "tests/a.test.ts");
    expect(tested.code, tested.out).toBe(0);
    expect(tested.out).toContain("PASSED: 1 chosen test path: no new failures");
    expect(await gateRuns()).toBe(1);
    expect(await vitestArgs()).toEqual([["tests/a.test.ts"]]);
    expect((await leases.getStatus("full-suite:origin")).leases).toEqual([]);

    expect((await land("submit")).out).toContain("Takode starts a landing run for it now.");
    const entry = await settled("focus");
    expect(entry.state).toBe("landed");
    expect(entry.preSubmitTest).toMatchObject({ kind: "focused", tests: ["tests/a.test.ts"] });
    // The landing run gated the whole tree again, with every test.
    expect(await gateRuns()).toBe(2);
    expect(await vitestArgs()).toEqual([["tests/a.test.ts"], []]);
  });

  it("checks, tries, saves and removes a branch's landing gate through the real CLI", async () => {
    const dir = await workerWith("gater", "gater.txt");
    const land = (...args: string[]) => takode("gater", dir, "land", ...args, "--branch", "main");

    // Without a saved gate the branch is not opted in: test and submit point to the classic flow.
    expect((await land("gate", "show")).out).toContain("No landing gate is saved for origin:main");
    const untested = await land("test");
    expect(untested.code).toBe(1);
    expect(untested.out).toContain("No landing gate is saved for origin:main on the Takode server");
    const refused = await land("submit", "--skip-test", "fixture");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("No landing gate is saved for origin:main");

    const draft = (name: string, config: unknown) => {
      const file = join(root, name);
      return writeFile(file, JSON.stringify(config)).then(() => file);
    };
    const bad = await land("gate", "save", await draft("bad.json", { version: 1, steps: [] }));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("at least one step");

    // Trying a draft runs it on the checkout without saving it.
    const failing = await draft("failing.json", {
      version: 1,
      steps: [{ name: "boom", run: ["sh", "-c", "echo nope; exit 1"] }],
    });
    const failed = await land("gate", "try", failing);
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("FAILED in step boom");
    const good = await draft("good.json", { version: 1, steps: [{ name: "check", run: ["sh", "gate.sh"] }] });
    const tried = await land("gate", "try", good);
    expect(tried.code).toBe(0);
    expect(tried.out).toContain("PASSED");
    expect(await gateRuns()).toBe(1);
    expect((await land("gate", "show")).out).toContain("No landing gate is saved");
    // The full-suite slot taken for the try is released again.
    expect((await leases.getStatus("full-suite:origin")).leases).toEqual([]);

    expect((await land("gate", "save", good)).code).toBe(0);
    expect((await land("gate", "show")).out).toContain("Landing gate for origin:main: 1 step(s) (check), saved");
    expect(JSON.parse((await land("gate", "show", "--json")).out)).toEqual({
      version: 1,
      steps: [{ name: "check", run: ["sh", "gate.sh"] }],
    });
    expect((await land("gate", "list")).out).toContain("origin:main  1 step(s) (check)");
    // Replacing a gate prints the old one so it can be restored.
    const replaced = await land("gate", "save", failing);
    expect(replaced.out).toContain("It replaced the gate saved");
    expect(replaced.out).toContain('"name": "check"');
    const removed = await land("gate", "remove");
    expect(removed.out).toContain("Removed the landing gate for origin:main");
    expect(removed.out).toContain('"name": "boom"');
    expect((await land("gate", "show")).out).toContain("No landing gate is saved");
  });

  it("fails clearly against a server that does not store landing gates", async () => {
    // A server from before saved gates answers 404 on the gate routes; the CLI must say why.
    const dir = await workerWith("early", "early.txt");
    const ctx = {
      authenticateTakodeCaller: () => ({ callerId: "early", caller: { sessionId: "early" } }),
      resourceLeaseManager: leases,
    } as never;
    const app = new Hono().route("/api", createResourceLeaseRoutes(ctx));
    const old = createServer(async (req, res) => {
      const response = await app.fetch(new Request(`http://localhost${req.url}`, { method: req.method }));
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    old.listen(0);
    await once(old, "listening");
    try {
      const oldPort = (old.address() as AddressInfo).port;
      for (const args of [["gate", "show"], ["test"]]) {
        const result = await takodeOn(oldPort, "early", dir, "land", ...args, "--branch", "main");
        expect(result.code).toBe(1);
        expect(result.out).toContain("does not store landing gates yet");
      }
    } finally {
      old.close();
    }
  });
});
