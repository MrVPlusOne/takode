#!/usr/bin/env bun
/**
 * Runs this checkout's Takode backend and Vite on the ports and state directory
 * of the dev-server:companion lease slot the calling session holds, so parallel
 * validation runs never collide with each other or with the live server.
 *
 * From web/:  bun --no-install scripts/validation-server.ts <status|start [--fresh]|stop>
 *              bun --no-install scripts/validation-server.ts <add-session <id|#N>|remove-session <id|#N|all>|list-sessions>
 *
 * `start` refuses occupied ports instead of stopping their owners. `stop` only
 * stops processes this session started and that still listen on their ports.
 * `add-session` copies a live session into the slot, merged with what the slot
 * already holds and unable to run a backend; `remove-session` takes it out again.
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
  validationServerEnv,
} from "../bin/validation-slots.js";
import { homedir } from "node:os";
import { apiGet, getBase } from "../bin/takode-core.js";
import { listeningPids } from "./listening-pids.js";
import {
  addSessionCopy,
  listSessionCopies,
  removeSessionCopies,
  type SessionCopyPaths,
  type SessionCopyRecord,
} from "./validation-session-copy.js";

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
  if (command === "add-session" && flags[0]) return addCopy(flags[0]);
  if (command === "remove-session" && flags[0]) return removeCopies(flags[0]);
  if (command === "list-sessions") return listCopies();
  fail(
    "Usage: bun --no-install scripts/validation-server.ts " +
      "<status|start [--fresh]|stop|add-session <id|#N>|remove-session <id|#N|all>|list-sessions>",
  );
}

/** The live server's session data (read only) and the held slot's copy of it. */
async function sessionCopyPaths(): Promise<{ res: DevServerSlot; paths: SessionCopyPaths }> {
  sessionId();
  const slot = await findHeldSlot(DEV_SERVER_LEASE);
  if (slot === null) fail(`Acquire ${DEV_SERVER_LEASE} first; this session holds no slot.`);
  const res = devServerSlot(slot);
  const liveCompanionDir = join(homedir(), ".companion");
  const slotCompanionDir = join(res.home, ".companion");
  return {
    res,
    paths: {
      liveCompanionDir,
      liveSessionsRoot: join(liveCompanionDir, "sessions"),
      slotCompanionDir,
      slotSessionsDir: join(slotCompanionDir, "sessions", String(res.backendPort)),
      // Inside HOME, so `start --fresh` forgets the copies along with them.
      manifestPath: join(res.home, "copied-sessions.json"),
    },
  };
}

async function addCopy(ref: string): Promise<void> {
  const { res, paths } = await stoppedSlotPaths();
  console.log(`Added ${describeCopy(await addSessionCopy(paths, ref))} to slot ${res.slot}.`);
}

async function removeCopies(ref: string): Promise<void> {
  const { res, paths } = await stoppedSlotPaths();
  const removed = await removeSessionCopies(paths, ref);
  if (removed.length === 0) console.log(`Slot ${res.slot} holds no copied sessions.`);
  for (const record of removed) console.log(`Removed ${describeCopy(record)} from slot ${res.slot}.`);
}

/** A running slot server keeps its own copy of these lists and would write it back over the change. */
async function stoppedSlotPaths(): Promise<{ res: DevServerSlot; paths: SessionCopyPaths }> {
  const slotPaths = await sessionCopyPaths();
  if ((await listeningPids(slotPaths.res.backendPort)).length > 0) {
    fail(`Stop the slot ${slotPaths.res.slot} server first (\`stop\`), and start it again after the change.`);
  }
  return slotPaths;
}

async function listCopies(): Promise<void> {
  const { res, paths } = await sessionCopyPaths();
  const copies = await listSessionCopies(paths);
  if (copies.length === 0) console.log(`Slot ${res.slot} holds no copied sessions.`);
  for (const record of copies) console.log(describeCopy(record));
}

function describeCopy(record: SessionCopyRecord): string {
  const number = record.sessionNum === null ? "" : `#${record.sessionNum} `;
  const quests = record.addedQuestIds.length > 0 ? `, ${record.addedQuestIds.length} quests` : "";
  return `${number}${record.sessionId} (${record.files.length} files${record.images ? ", images" : ""}${quests})`;
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
  const testKey = await openAITestKey();
  const env = validationServerEnv(process.env, res, testKey);
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
  if (!testKey) {
    console.log(
      "  OpenAI    no test key set (Settings > Voice > Test Key for Agents); voice and Read aloud report a missing key",
    );
  }
}

/** The user's OpenAI key for agent tests, or null when none is set. */
async function openAITestKey(): Promise<string | null> {
  const result = (await apiGet(getBase([]), "/settings/openai-test-key")) as { apiKey: string | null };
  return result.apiKey;
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
