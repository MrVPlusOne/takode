#!/usr/bin/env bun
/**
 * Runs this checkout's Takode backend and Vite on the ports and state directory
 * of the dev-server:companion lease slot the calling session holds, so parallel
 * validation runs never collide with each other or with the live server.
 *
 * From web/:  bun --no-install scripts/validation-server.ts <status|start [--fresh]|stop>
 *
 * `start` refuses occupied ports instead of stopping their owners. `stop` only
 * stops processes this session started and that still listen on their ports.
 */
import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_BROWSER_LEASE,
  agentBrowserSession,
  DEV_SERVER_LEASE,
  type DevServerSlot,
  devServerSlot,
  findHeldSlot,
} from "../bin/validation-slots.js";
import { listeningPids } from "./listening-pids.js";

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_ROOT = dirname(devServerSlot(1).stateDir);
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;

/** What `start` launched, kept in the slot's state directory. */
interface ServerRecord {
  ownerSessionId: string;
  slot: number;
  checkout: string;
  backendPid: number;
  vitePid: number;
}

async function main(): Promise<void> {
  const [command = "status", ...flags] = process.argv.slice(2);
  if (command === "start") return start(flags.includes("--fresh"));
  if (command === "stop") return stop();
  if (command === "status") return status();
  fail("Usage: bun --no-install scripts/validation-server.ts <status|start [--fresh]|stop>");
}

async function status(): Promise<void> {
  const devSlot = await findHeldSlot(DEV_SERVER_LEASE);
  const browserSlot = await findHeldSlot(AGENT_BROWSER_LEASE);
  if (devSlot === null) console.log(`${DEV_SERVER_LEASE}: no slot held`);
  else {
    const res = devServerSlot(devSlot);
    const record = await readRecord(res);
    const running = record?.ownerSessionId === sessionId() && (await isRunning(record, res));
    printSlot(res, running ? "running" : "not running");
  }
  if (browserSlot === null) console.log(`${AGENT_BROWSER_LEASE}: no slot held`);
  else console.log(`${AGENT_BROWSER_LEASE} slot ${browserSlot}: session ${agentBrowserSession(browserSlot)}`);
}

async function start(fresh: boolean): Promise<void> {
  const owner = sessionId();
  const slot = await findHeldSlot(DEV_SERVER_LEASE);
  if (slot === null) fail(`Acquire ${DEV_SERVER_LEASE} first; this session holds no slot.`);
  const res = devServerSlot(slot);

  const previous = await readRecord(res);
  if (previous?.ownerSessionId === owner && (await isRunning(previous, res))) {
    printSlot(res, `already running from ${previous.checkout}`);
    return;
  }
  for (const port of [res.backendPort, res.vitePort]) {
    const pids = await listeningPids(port);
    if (pids.length > 0) {
      fail(
        `Port ${port} of slot ${slot} is in use by PID ${pids.join(", ")}. ` +
          "If that is your own earlier run, use `stop` first; never stop a process you did not start.",
      );
    }
  }

  if (fresh) await rm(res.home, { recursive: true, force: true });
  await mkdir(res.home, { recursive: true });
  const env = {
    ...withoutTakodeEnv(process.env),
    HOME: res.home,
    PORT: String(res.backendPort),
    NODE_ENV: "development",
  };
  const record: ServerRecord = {
    ownerSessionId: owner,
    slot,
    checkout: WEB_DIR,
    backendPid: await launch(
      process.execPath,
      ["--no-install", "server/index.ts"],
      env,
      join(res.stateDir, "backend.log"),
    ),
    vitePid: await launch(
      "./node_modules/.bin/vite",
      ["--port", String(res.vitePort), "--strictPort"],
      env,
      join(res.stateDir, "vite.log"),
    ),
  };
  await writeFile(recordPath(res), `${JSON.stringify(record, null, 2)}\n`);

  if (!(await waitUntilReady(res))) {
    await stopRecord(record, res);
    fail(`Slot ${slot} servers did not become ready; see ${res.stateDir}/backend.log and vite.log.`);
  }
  printSlot(res, "running");
}

async function stop(): Promise<void> {
  const owner = sessionId();
  const dirs = await readdir(STATE_ROOT).catch(() => [] as string[]);
  let stopped = 0;
  for (const dir of dirs) {
    const slot = Number(dir.replace("dev-server-", ""));
    if (!Number.isInteger(slot)) continue;
    const res = devServerSlot(slot);
    const record = await readRecord(res);
    if (record?.ownerSessionId !== owner) continue;
    await stopRecord(record, res);
    stopped += 1;
  }
  console.log(stopped > 0 ? "Stopped your validation servers." : "No validation servers started by this session.");
}

function printSlot(res: DevServerSlot, state: string): void {
  console.log(`${DEV_SERVER_LEASE} slot ${res.slot}: ${state}`);
  console.log(`  frontend  http://127.0.0.1:${res.vitePort}`);
  console.log(`  backend   http://127.0.0.1:${res.backendPort}`);
  console.log(`  HOME      ${res.home}`);
  console.log(`  logs      ${res.stateDir}/backend.log, vite.log`);
}

function sessionId(): string {
  const id = process.env.COMPANION_SESSION_ID;
  if (!id) fail("Run this from a Takode session; COMPANION_SESSION_ID is not set.");
  return id;
}

/**
 * Agent shells inherit the live server's identity (server ID, frontend snapshot,
 * supervision, session credentials). A validation server must not adopt it.
 */
function withoutTakodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("COMPANION_") && !key.startsWith("TAKODE_")),
  );
}

async function launch(command: string, args: string[], env: NodeJS.ProcessEnv, logPath: string): Promise<number> {
  const log = await open(logPath, "a");
  try {
    const child = spawn(command, args, { cwd: WEB_DIR, env, detached: true, stdio: ["ignore", log.fd, log.fd] });
    if (child.pid === undefined) fail(`Could not start ${command}; see ${logPath}.`);
    child.unref();
    return child.pid;
  } finally {
    await log.close();
  }
}

async function waitUntilReady(res: DevServerSlot): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [backend, vite] = await Promise.all([
      isHttpOk(`http://127.0.0.1:${res.backendPort}/api/health`),
      isHttpOk(`http://127.0.0.1:${res.vitePort}/`),
    ]);
    if (backend && vite) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function isHttpOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false; // Not listening yet.
  }
}

async function isRunning(record: ServerRecord, res: DevServerSlot): Promise<boolean> {
  const [backendPids, vitePids] = await Promise.all([listeningPids(res.backendPort), listeningPids(res.vitePort)]);
  return backendPids.includes(record.backendPid) && vitePids.includes(record.vitePid);
}

/** Stops each recorded process only while it still listens on its own port. */
async function stopRecord(record: ServerRecord, res: DevServerSlot): Promise<void> {
  const owned: Array<[number, number]> = [
    [record.backendPid, res.backendPort],
    [record.vitePid, res.vitePort],
  ];
  for (const [pid, port] of owned) {
    if (!(await listeningPids(port)).includes(pid)) continue;
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline && isAlive(pid)) await new Promise((r) => setTimeout(r, 200));
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  }
  await rm(recordPath(res), { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRecord(res: DevServerSlot): Promise<ServerRecord | null> {
  const text = await readFile(recordPath(res), "utf-8").catch(() => null);
  return text ? (JSON.parse(text) as ServerRecord) : null;
}

function recordPath(res: DevServerSlot): string {
  return join(res.stateDir, "servers.json");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((err) => fail((err as Error).message));
