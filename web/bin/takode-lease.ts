import { parseDuration } from "../server/timer-parse.js";

type ApiGet = (path: string) => Promise<unknown>;
type ApiPost = (path: string, body?: unknown) => Promise<unknown>;

export interface TakodeLeaseDeps {
  apiGet: ApiGet;
  apiPost: ApiPost;
  err: (message: string) => never;
  formatInlineText: (value: unknown) => string;
  formatTimestampCompact: (epoch: number) => string;
}

interface LeaseDetail {
  resourceKey: string;
  slot: number;
  ownerSessionId: string;
  ownerSessionNum?: number;
  ownerSessionName?: string;
  questId?: string;
  purpose: string;
  metadata: Record<string, string>;
  acquiredAt: number;
  heartbeatAt: number;
  ttlMs: number;
  expiresAt: number;
}

interface WaiterDetail {
  id: string;
  resourceKey: string;
  waiterSessionId: string;
  waiterSessionNum?: number;
  waiterSessionName?: string;
  questId?: string;
  purpose: string;
  metadata: Record<string, string>;
  queuedAt: number;
  ttlMs: number;
}

interface LeaseStatusDetail {
  resourceKey: string;
  capacity: number;
  leases: LeaseDetail[];
  waiters: WaiterDetail[];
  available: boolean;
}

type AcquireResult =
  | { status: "acquired" | "already_owned"; capacity: number; lease: LeaseDetail; waiters: WaiterDetail[] }
  | (LeaseStatusDetail & { status: "queued"; waiter: WaiterDetail; position: number })
  | (LeaseStatusDetail & { status: "unavailable" });

export const LEASE_HELP = `Usage: takode lease <configure|acquire|status|list|renew|heartbeat|release|wait> ...

Coordinate named global resources such as dev-server:companion or agent-browser.

Subcommands:
  configure <resource> --capacity <count> [--json]  (leader only; idle pool)
  acquire <resource> --purpose <text> [--ttl <duration>] [--quest q-N] [--metadata k=v] [--wait] [--json]
  wait <resource> --purpose <text> [--ttl <duration>] [--quest q-N] [--metadata k=v] [--json]
  status [resource] [--json]
  list [--json]
  renew <resource> [--ttl <duration>] [--slot <number>] [--json]
  heartbeat <resource> [--ttl <duration>] [--slot <number>] [--json]
  release <resource> [--slot <number>] [--force] [--json]

Use scoped keys by convention when useful, for example dev-server:companion.
Unconfigured resources have capacity one. One slot per session per pool.
Slots are reusable numbers for workflow-owned port/directory mapping, not process limits.
Default TTL is 30m. Heartbeat while working and release promptly when done.
`;

export const LEASE_CONFIGURE_HELP = `Usage: takode lease configure <resource> --capacity <count> [--json]

Leaders set a positive integer capacity according to the user's resource budget.
Actual changes require no leased slots; setting the same value is a no-op.
This bounds reservations on this server, not processes or memory use.
`;

export const LEASE_ACQUIRE_HELP = `Usage: takode lease acquire <resource> --purpose <text> [--ttl <duration>] [--quest q-N] [--metadata k=v] [--wait] [--json]

Acquire the lowest free numbered slot, after FIFO waiters. Repeated acquisition
returns your existing slot; child jobs sharing your session share that reservation.
If full, --wait queues you until a Resource Lease message identifies your slot.
`;

export const LEASE_WAIT_HELP = `Usage: takode lease wait <resource> --purpose <text> [--ttl <duration>] [--quest q-N] [--metadata k=v] [--json]

Acquire immediately if the resource is free; otherwise join the FIFO waiter queue.
When queued, the server will send your session a Resource Lease message when
the lease is promoted; you do not need to poll.
`;

export const LEASE_STATUS_HELP = `Usage: takode lease status [resource] [--json]
       takode lease list [--json]

Inspect pool capacity, slot holders and FIFO waiter queues. List summarizes pools. Status is inspection only; acquire the
lease before starting or using the shared resource.
`;

export const LEASE_RENEW_HELP = `Usage: takode lease renew <resource> [--ttl <duration>] [--slot <number>] [--json]
       takode lease heartbeat <resource> [--ttl <duration>] [--slot <number>] [--json]

Heartbeat your current slot and extend its expiry. Without --ttl, the existing TTL is reused.
Optional --slot explicitly selects a slot and still requires ownership. Slots are reused;
commands target the current reservation, not a unique acquisition lifetime.
`;

export const LEASE_RELEASE_HELP = `Usage: takode lease release <resource> [--slot <number>] [--force] [--json]

Release your current slot. If waiters exist, the first waiter is promoted and notified.
Optional --slot selects a slot; normal release still requires ownership.
Multi-slot leader force release requires --slot; it never releases the whole pool.
Capacity-one pools retain release <resource> --force. Commands target current
reservations, so delayed same-session commands are not fenced after reacquisition.
Leaders may use --force to release another session's lease on this server when
recovering an abandoned reservation or coordinating a handoff. Prefer normal
owner release or queueing while the holder is using the resource. Use judgment
about conflicting use; releasing a lease does not stop processes or grant
permission for the underlying resource operations.
`;

export async function handleLease(args: string[], deps: TakodeLeaseDeps): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case "configure":
      await handleConfigure(args.slice(1), deps);
      return;
    case "acquire":
      await handleAcquire(args.slice(1), deps, false);
      return;
    case "wait":
      await handleAcquire(args.slice(1), deps, true);
      return;
    case "status":
    case "list":
      await handleStatus(args.slice(1), deps);
      return;
    case "renew":
    case "heartbeat":
      await handleRenew(args.slice(1), deps);
      return;
    case "release":
      await handleRelease(args.slice(1), deps);
      return;
    default:
      deps.err(LEASE_HELP);
  }
}

async function handleConfigure(args: string[], deps: TakodeLeaseDeps): Promise<void> {
  const resource = firstPositional(args);
  if (!resource) deps.err(LEASE_CONFIGURE_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, new Set(["capacity", "json"]), LEASE_CONFIGURE_HELP, deps);
  const capacity = integerFlag(flags, "capacity", deps);
  if (capacity === undefined) deps.err(`--capacity is required\n${LEASE_CONFIGURE_HELP}`);
  const response = (await deps.apiPost(`/resource-leases/${encodeURIComponent(resource)}/configure`, { capacity })) as {
    resource: LeaseStatusDetail;
  };
  if (flags.json === true) console.log(JSON.stringify(response, null, 2));
  else printStatuses([response.resource], deps, false);
}

async function handleAcquire(args: string[], deps: TakodeLeaseDeps, waitByDefault: boolean): Promise<void> {
  const resource = firstPositional(args);
  if (!resource) deps.err(waitByDefault ? LEASE_WAIT_HELP : LEASE_ACQUIRE_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(
    flags,
    new Set(["purpose", "ttl", "quest", "metadata", "wait", "json"]),
    waitByDefault ? LEASE_WAIT_HELP : LEASE_ACQUIRE_HELP,
    deps,
  );
  const purpose = stringFlag(flags, "purpose");
  if (!purpose) deps.err(`--purpose is required\n${waitByDefault ? LEASE_WAIT_HELP : LEASE_ACQUIRE_HELP}`);
  const payload: Record<string, unknown> = {
    purpose,
    metadata: parseMetadata(args, deps),
  };
  const ttl = stringFlag(flags, "ttl");
  if (ttl) payload.ttlMs = parseDuration(ttl);
  const quest = stringFlag(flags, "quest");
  if (quest) payload.questId = quest;
  if (waitByDefault || flags.wait === true) payload.wait = true;

  const path = `/resource-leases/${encodeURIComponent(resource)}/${waitByDefault ? "wait" : "acquire"}`;
  const response = (await deps.apiPost(path, payload)) as { result: AcquireResult };
  const jsonMode = flags.json === true;
  if (jsonMode) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  printAcquireResult(response.result, deps);
}

async function handleStatus(args: string[], deps: TakodeLeaseDeps): Promise<void> {
  const flags = parseFlags(args);
  assertKnownFlags(flags, new Set(["json"]), LEASE_STATUS_HELP, deps);
  const resource = firstPositional(args);
  const response = resource
    ? ((await deps.apiGet(`/resource-leases/${encodeURIComponent(resource)}`)) as { resource: LeaseStatusDetail })
    : ((await deps.apiGet("/resource-leases")) as { resources: LeaseStatusDetail[] });
  if (flags.json === true) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const statuses = "resource" in response ? [response.resource] : response.resources;
  if (statuses.length === 0) {
    console.log("No configured resource pools, active leases or waiters.");
    return;
  }
  printStatuses(statuses, deps, !!resource);
}

async function handleRenew(args: string[], deps: TakodeLeaseDeps): Promise<void> {
  const resource = firstPositional(args);
  if (!resource) deps.err(LEASE_RENEW_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, new Set(["ttl", "slot", "json"]), LEASE_RENEW_HELP, deps);
  const payload: Record<string, unknown> = {};
  const ttl = stringFlag(flags, "ttl");
  if (ttl) payload.ttlMs = parseDuration(ttl);
  const slot = integerFlag(flags, "slot", deps);
  if (slot !== undefined) payload.slot = slot;
  const response = (await deps.apiPost(`/resource-leases/${encodeURIComponent(resource)}/renew`, payload)) as {
    lease: LeaseDetail;
  };
  if (flags.json === true) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  console.log(
    `Renewed ${response.lease.resourceKey} slot ${response.lease.slot}; expires ${deps.formatTimestampCompact(response.lease.expiresAt)}.`,
  );
}

async function handleRelease(args: string[], deps: TakodeLeaseDeps): Promise<void> {
  const resource = firstPositional(args);
  if (!resource) deps.err(LEASE_RELEASE_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, new Set(["force", "slot", "json"]), LEASE_RELEASE_HELP, deps);
  if (flags.force !== undefined && flags.force !== true)
    deps.err(`--force does not take a value\n${LEASE_RELEASE_HELP}`);
  const force = flags.force === true;
  const slot = integerFlag(flags, "slot", deps);
  const response = (await deps.apiPost(`/resource-leases/${encodeURIComponent(resource)}/release`, {
    ...(force ? { force: true } : {}),
    ...(slot === undefined ? {} : { slot }),
  })) as {
    result: { released: LeaseDetail; promoted: LeaseDetail | null; waiters: WaiterDetail[] };
  };
  if (flags.json === true) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  const promoted = response.result.promoted
    ? ` Promoted ${response.result.promoted.ownerSessionId} to slot ${response.result.promoted.slot}.`
    : "";
  const released = response.result.released;
  const action = force
    ? `Force-released ${released.resourceKey} slot ${released.slot}; previous owner: ${formatLeaseOwner(released, deps)}.`
    : `Released ${released.resourceKey} slot ${released.slot}.`;
  console.log(`${action}${promoted}`);
}

function printAcquireResult(result: AcquireResult, deps: TakodeLeaseDeps): void {
  if (result.status === "queued") {
    const waiterCount = Math.max(result.waiters.length, result.position);
    const positionSuffix = waiterCount > 0 ? ` of ${waiterCount}` : "";
    console.log(`Queued for ${result.waiter.resourceKey} at position ${result.position}${positionSuffix}.`);
    printStatuses([result], deps, true);
    console.log("You will receive a Resource Lease message in this session when promoted; no polling is needed.");
    return;
  }
  if (result.status === "unavailable") {
    console.log(
      `Unavailable: ${result.resourceKey}; ${result.leases.length}/${result.capacity} slots held, ${result.waiters.length} waiting.`,
    );
    return;
  }
  const label = result.status === "already_owned" ? "Already holding" : "Acquired";
  console.log(
    `${label} ${result.lease.resourceKey} slot ${result.lease.slot} of ${result.capacity}; expires ${deps.formatTimestampCompact(result.lease.expiresAt)}.`,
  );
}

function printStatuses(statuses: LeaseStatusDetail[], deps: TakodeLeaseDeps, details: boolean): void {
  for (const status of statuses) {
    console.log(
      `${status.resourceKey}: ${status.leases.length}/${status.capacity} slots held, ${status.capacity - status.leases.length} free; ${status.waiters.length} waiting`,
    );
    if (!details) continue;
    for (const lease of status.leases) {
      console.log(`  slot ${lease.slot} owner: ${formatLeaseOwner(lease, deps)}`);
      console.log(`    acquired: ${formatTimeWithAge(lease.acquiredAt, deps)}`);
      console.log(`    heartbeat: ${formatTimeWithAge(lease.heartbeatAt, deps)}`);
      console.log(`    ttl: ${formatDuration(lease.ttlMs)}`);
      console.log(`    expires: ${formatTimeWithAge(lease.expiresAt, deps, "from now")}`);
      if (lease.questId) console.log(`    quest: ${lease.questId}`);
      const metadata = formatMetadata(lease.metadata);
      if (metadata) console.log(`    metadata: ${metadata}`);
      console.log(`    purpose: ${deps.formatInlineText(lease.purpose)}`);
    }
    if (status.waiters.length > 0) {
      console.log(`  waiters: ${status.waiters.length}`);
      for (const waiter of status.waiters) {
        console.log(`    ${waiter.id}: ${formatWaiter(waiter, deps)}`);
        console.log(`      queued: ${formatTimeWithAge(waiter.queuedAt, deps)}`);
        console.log(`      requested ttl: ${formatDuration(waiter.ttlMs)}`);
        if (waiter.questId) console.log(`      quest: ${waiter.questId}`);
        const metadata = formatMetadata(waiter.metadata);
        if (metadata) console.log(`      metadata: ${metadata}`);
        console.log(`      purpose: ${deps.formatInlineText(waiter.purpose)}`);
      }
    }
  }
}

function formatLeaseOwner(lease: LeaseDetail, deps: TakodeLeaseDeps): string {
  return formatSessionReference(lease.ownerSessionId, lease.ownerSessionNum, lease.ownerSessionName, deps);
}

function formatWaiter(waiter: WaiterDetail, deps: TakodeLeaseDeps): string {
  return formatSessionReference(waiter.waiterSessionId, waiter.waiterSessionNum, waiter.waiterSessionName, deps);
}

function formatSessionReference(
  sessionId: string,
  sessionNum: number | undefined,
  sessionName: string | undefined,
  deps: TakodeLeaseDeps,
): string {
  const id = deps.formatInlineText(sessionId);
  const trimmedName = sessionName?.trim();
  const label = typeof sessionNum === "number" ? `#${sessionNum}` : "";
  const name = trimmedName ? deps.formatInlineText(trimmedName) : "";
  if (label && name) return `${label} ${name} (${id})`;
  if (label) return `${label} (${id})`;
  if (name) return `${name} (${id})`;
  return id;
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function assertKnownFlags(
  flags: Record<string, string | boolean>,
  allowed: Set<string>,
  usage: string,
  deps: TakodeLeaseDeps,
): void {
  const unknown = Object.keys(flags).filter((key) => !allowed.has(key));
  if (unknown.length > 0) deps.err(`Unknown option(s): ${unknown.map((key) => `--${key}`).join(", ")}\n${usage}`);
}

function firstPositional(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerFlag(flags: Record<string, string | boolean>, key: string, deps: TakodeLeaseDeps): number | undefined {
  if (flags[key] === undefined) return undefined;
  const raw = stringFlag(flags, key);
  const value = Number(raw);
  if (!raw || !/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
    deps.err(`--${key} requires a positive integer`);
  return value;
}

function parseMetadata(args: string[], deps: TakodeLeaseDeps): Record<string, string> {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--metadata") continue;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) deps.err("--metadata requires k=v");
    values.push(value);
    i++;
  }
  const metadata: Record<string, string> = {};
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const index = part.indexOf("=");
      if (index <= 0) deps.err(`Invalid --metadata value "${part}". Use k=v.`);
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key && value) metadata[key] = value;
    }
  }
  return metadata;
}

function formatMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatTimeWithAge(epoch: number, deps: TakodeLeaseDeps, futureSuffix = "ago"): string {
  const ageMs = Date.now() - epoch;
  const absolute = deps.formatTimestampCompact(epoch);
  if (!Number.isFinite(ageMs)) return absolute;
  if (ageMs >= 0) return `${absolute} (${formatDuration(ageMs)} ${futureSuffix})`;
  return `${absolute} (${formatDuration(Math.abs(ageMs))} ${futureSuffix})`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.slice(0, 2).join(" ");
}
