import type { MachineInfo } from "../machine-identity.js";

/**
 * Where the coordinator learns about machines: its own, the registered hosts
 * (names from the registry, platform and user from their last `hello`), and
 * which machine each session runs on. Configured once at server startup.
 */
export interface MachineSources {
  /** The coordinator's own machine. */
  local(): MachineInfo;
  /** A registered host's name, or null when it is not registered. */
  hostName(hostId: string): string | null;
  /** What a host reported about itself since this server started; null before it connected. */
  hostDetails(hostId: string): Omit<MachineInfo, "name"> | null;
  /** The host a session runs on: undefined for an unknown session, null for the coordinator's machine. */
  sessionHostId(sessionId: string): string | null | undefined;
}

let sources: MachineSources | null = null;

export function configureMachines(next: MachineSources | null): void {
  sources = next;
}

/** The machine `hostId` names (the coordinator's own when absent); null when unknown or not configured. */
export function describeMachine(hostId?: string | null): MachineInfo | null {
  if (!sources) return null;
  if (!hostId) return sources.local();
  const name = sources.hostName(hostId);
  if (!name) return null;
  return { name, platform: null, user: null, home: null, ...sources.hostDetails(hostId) };
}

/** Name of the machine a session runs on, which quest notes it writes are stamped with. */
export function sessionMachineName(sessionId: string | undefined): string | undefined {
  if (!sources || !sessionId) return undefined;
  const hostId = sources.sessionHostId(sessionId);
  if (hostId === undefined) return undefined;
  return describeMachine(hostId)?.name;
}

/**
 * Tells a session which machine it runs on and where the coordinator's data
 * lives, for its injected instructions (by host) and memory catalog (by session).
 */
export function machineContextForHost(hostId?: string | null): string | null {
  const session = describeMachine(hostId);
  const coordinator = describeMachine(null);
  if (!session || !coordinator) return null;
  const coordinatorText = hostId
    ? `. The Takode coordinator, which holds quests and memory, runs on machine \`${coordinator.name}\`${platformSuffix(coordinator)}.`
    : ", which also runs the Takode coordinator that holds quests and memory.";
  return (
    `This session runs on machine \`${session.name}\`${detailSuffix(session)}${coordinatorText} ` +
    "Quest notes and debriefs are stamped with the machine they were written on: paths, commands and environment details in notes from another machine describe that machine, not this one."
  );
}

export function machineContextForSession(sessionId: string | undefined): string | null {
  if (!sources || !sessionId) return null;
  const hostId = sources.sessionHostId(sessionId);
  return hostId === undefined ? null : machineContextForHost(hostId);
}

const PLATFORM_NAMES: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

function platformName(machine: MachineInfo): string | null {
  return machine.platform ? (PLATFORM_NAMES[machine.platform] ?? machine.platform) : null;
}

function platformSuffix(machine: MachineInfo): string {
  return machine.platform ? ` (${platformName(machine)})` : "";
}

function detailSuffix(machine: MachineInfo): string {
  const details = [
    platformName(machine),
    machine.user ? `user \`${machine.user}\`` : null,
    machine.home ? `home \`${machine.home}\`` : null,
  ].filter(Boolean);
  return details.length ? ` (${details.join(", ")})` : "";
}
