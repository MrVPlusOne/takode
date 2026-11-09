import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

// `takode timer create --check`: the CLI forwards the check, machine and wake
// count to the server and prints the first check's result, or that the check
// already passes and no timer was made. Runs the real CLI against a fake server.

let root: string;
let server: Server;
let port: number;
let bodies: Array<Record<string, unknown>>;
let firstExitCode: number;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "takode-timer-check-"));
  bodies = [];
  firstExitCode = 1;
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (!req.url?.endsWith("/timers")) {
      res.end("{}");
      return;
    }
    bodies.push(body);
    res.end(
      JSON.stringify({
        timer: {
          id: "t4",
          title: body.title,
          type: "recurring",
          originalSpec: body.every,
          nextFireAt: Date.now() + 300_000,
          fireCount: 0,
          description: "",
          check: {
            command: body.check,
            host: body.host ?? "devbox",
            wakeEvery: body.wakeEvery ?? 10,
            checksSinceWake: 0,
            lastResult: { at: Date.now(), exitCode: firstExitCode, output: firstExitCode ? "2/16 done\n" : "DONE\n" },
          },
        },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function takode(args: string[]) {
  const script = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [script, ...args, "--port", String(port)], {
    cwd: root,
    env: { ...process.env, COMPANION_SESSION_ID: "timer-check-fixture", COMPANION_AUTH_TOKEN: "fixture-token" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

const create = ["timer", "create", "Run done", "--every", "5m"];

it("sends the check, machine and wake count and prints the first result", async () => {
  const result = await takode([...create, "--host", "condor", "--check", "grep -q DONE b.log", "--wake-every", "4"]);
  expect(result.code, result.stderr).toBe(0);
  expect(bodies).toEqual([
    { title: "Run done", every: "5m", host: "condor", check: "grep -q DONE b.log", wakeEvery: 4 },
  ]);
  expect(result.stdout).toContain("Created timer t4");
  expect(result.stdout).toContain("every 4 checks that do not");
  expect(result.stdout).toContain("First check: exit 1. Output:\n2/16 done");
});

it("says so when the check already passes", async () => {
  firstExitCode = 0;
  const result = await takode([...create, "--check", "grep DONE b.log"]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("The check already passes on devbox, so no timer was created");
  expect(result.stdout).toContain("DONE");
  expect(result.stdout).not.toContain("Created timer");
});

it("rejects check options without a check, and a bad wake count, before calling the server", async () => {
  expect((await takode([...create, "--wake-every", "3"])).stderr).toContain("apply to a timer with a --check");
  expect((await takode([...create, "--check", "true", "--wake-every", "0"])).stderr).toContain("whole number");
  expect(bodies).toEqual([]);
});
