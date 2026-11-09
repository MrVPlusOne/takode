/**
 * `takode lease run`: run a command here while holding a slot of a lease
 * pool. The slot belongs to this one command, not to the session, so a
 * session and its sub-agents can hold as many slots as they run commands. It
 * waits quietly in line when the pool is full and gives the slot back when
 * the command ends.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:os";
import { nestedPoolWarning, STILL_WAITING_EVERY_MS, stillWaitingLine } from "./pool-wait-notes.js";
import { err, takodeAuthHeaders } from "./takode-core.js";

export const LEASE_RUN_HELP = `Usage: takode lease run <pool> [--purpose <text>] -- <command...>

Run a command here (same folder, environment, input and output) while holding
a slot of the pool, so commands of every session and sub-agent that use the
pool share its capacity. When the pool is full it waits in line, quietly: no
message reaches the session, and the command starts when a slot frees up.
The slot is given back when the command ends; the exit code is the command's.

One argument after -- runs as a shell command line ('make -j4 && make test');
several run as that program and its arguments, without a shell.

The pool is on this machine unless named with @<machine>, like other leases.
A leader sets its size with takode lease configure <pool> --capacity <n>;
unconfigured pools have one slot. The command sees TAKODE_LEASE_RESOURCE and
TAKODE_LEASE_SLOT. Time spent waiting counts against your tool's timeout; a
long wait prints a line every 5 minutes saying who holds the pool.

Nested slots can deadlock. A command holding a slot that starts another
command waiting for the same pool (a script run with takode lease run that
itself calls takode lease run or takode exec --pool on that pool) waits
forever once outer commands hold every slot. It is allowed, with a warning;
take a pool's slot once, in the outer or the inner command.

Ctrl-C or a tool timeout stops the command and gives the slot back. If this
process is killed outright while the command keeps running, the slot is freed
about two minutes later anyway. For commands on another machine, prefer
takode exec --pool, which also stops the command when its caller goes away.
`;

/** How long one request waits for the slot (or for losing it) before asking again. */
const WAIT_SECONDS = 25;
/** How long to keep retrying while the coordinator is unreachable, e.g. restarting. */
const RECONNECT_MS = 5 * 60_000;
const MAX_PURPOSE = 280;

type HoldState =
  | { status: "held"; lease: { resourceKey: string; slot: number } }
  | { status: "queued"; resourceKeys: string[]; position: number; note?: string }
  | { status: "gone" };

export async function handleLeaseRun(base: string, args: string[]): Promise<void> {
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  const command = separator === -1 ? [] : args.slice(separator + 1);
  if (options.includes("--help") || options.includes("-h")) {
    console.log(LEASE_RUN_HELP);
    return;
  }
  const pool = options.find((arg, index) => !arg.startsWith("--") && options[index - 1] !== "--purpose");
  const purposeIndex = options.indexOf("--purpose");
  const unknown = options.find((arg) => arg.startsWith("--") && arg !== "--purpose");
  if (unknown) err(`Unknown option ${unknown}\n${LEASE_RUN_HELP}`);
  if (!pool || command.length === 0) err(LEASE_RUN_HELP);
  const commandLine = command.join(" ");
  const purpose =
    (purposeIndex === -1 ? undefined : options[purposeIndex + 1]?.trim()) ||
    `takode lease run: ${commandLine.length > MAX_PURPOSE ? `${commandLine.slice(0, MAX_PURPOSE)}...` : commandLine}`;

  const nested = nestedPoolWarning(pool);
  if (nested) console.error(`[takode lease run] ${nested}`);

  const holderId = `run:${randomUUID()}`;
  const hold = async (path: string, body: unknown, signal?: AbortSignal) =>
    ((await postWithRetry(base, path, body, signal)) as { state: HoldState }).state;
  let state = await hold(`/resource-leases/${encodeURIComponent(pool)}/hold`, { holderId, purpose });
  if (state.status === "queued") {
    console.error(
      `[takode lease run] waiting for a slot of ${state.resourceKeys.join(" or ")} (place ${state.position} in line)`,
    );
  }
  // Stopped while waiting: leave the line, as a stopped command would.
  const leaveLine = () => {
    void postWithRetry(base, `/resource-leases/holds/${holderId}/release`, {}).finally(() => process.exit(130));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, leaveLine);
  const queuedAt = Date.now();
  let notedAt = queuedAt;
  while (state.status === "queued") {
    state = await hold(`/resource-leases/holds/${holderId}/wait`, { known: "queued", waitSeconds: WAIT_SECONDS });
    if (state.status === "queued" && Date.now() - notedAt >= STILL_WAITING_EVERY_MS) {
      notedAt = Date.now();
      console.error(`[takode lease run] ${stillWaitingLine(notedAt - queuedAt, state.note)}`);
    }
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.removeListener(signal, leaveLine);
  if (state.status === "gone") err("Lost the place in line for the pool (a leader removed it, or it expired)");
  const lease = state.lease;

  const child =
    command.length === 1
      ? spawn("/bin/sh", ["-c", command[0]!], { stdio: "inherit", env: leaseEnv(lease) })
      : spawn(command[0]!, command.slice(1), { stdio: "inherit", env: leaseEnv(lease) });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));

  // Keep the slot while the command runs; one long poll per WAIT_SECONDS renews it.
  const done = new AbortController();
  const heartbeat = (async () => {
    while (!done.signal.aborted) {
      const now = await hold(
        `/resource-leases/holds/${holderId}/wait`,
        { known: "held", waitSeconds: WAIT_SECONDS },
        done.signal,
      ).catch((error) => (done.signal.aborted ? null : Promise.reject(error)));
      if (now?.status === "gone") {
        console.error(
          `[takode lease run] the slot of ${lease.resourceKey} was taken back (a leader released it, or it expired); the command keeps running`,
        );
        return;
      }
    }
  })().catch((error) => console.error(`[takode lease run] could not keep the slot: ${error.message}`));

  const exitCode = await new Promise<number>((resolve) => {
    child.once("error", (error) => {
      console.error(`[takode lease run] could not start ${command[0]}: ${error.message}`);
      resolve(127);
    });
    child.once("exit", (code, signal) =>
      resolve(signal ? 128 + (constants.signals[signal as keyof typeof constants.signals] ?? 0) : (code ?? 1)),
    );
  });
  done.abort();
  await heartbeat;
  await postWithRetry(base, `/resource-leases/holds/${holderId}/release`, {}).catch((error) =>
    console.error(`[takode lease run] could not give the slot back (it frees itself shortly): ${error.message}`),
  );
  process.exit(exitCode);
}

function leaseEnv(lease: { resourceKey: string; slot: number }): NodeJS.ProcessEnv {
  return { ...process.env, TAKODE_LEASE_RESOURCE: lease.resourceKey, TAKODE_LEASE_SLOT: String(lease.slot) };
}

/** A POST's JSON answer, waiting out a coordinator that is briefly unreachable, such as during a restart. */
async function postWithRetry(base: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const deadline = Date.now() + RECONNECT_MS;
  for (;;) {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: takodeAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || Date.now() > deadline) throw error;
      await Bun.sleep(1_000);
      continue;
    }
    if ((response.status === 502 || response.status === 503) && Date.now() < deadline) {
      await Bun.sleep(1_000);
      continue;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
}
