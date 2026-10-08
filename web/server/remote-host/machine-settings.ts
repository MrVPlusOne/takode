import { LOCAL_HOST_ID, type MachineSettings } from "./host-registry.js";

/** Where machine settings come from: the host registry, or a stand-in in tests. */
export interface MachineSettingsSource {
  machineSettings(hostId: string): MachineSettings;
}

let registry: MachineSettingsSource | null = null;

/** Called once at server startup, after the registry has loaded, so launches read each machine's settings. */
export function configureMachineSettings(hosts: MachineSettingsSource | null): void {
  registry = hosts;
}

/**
 * Settings of the machine a session runs on: the remote host `hostId`, or
 * this machine when it is absent. Without a configured registry (tests,
 * tools), every machine uses the defaults.
 */
export function machineSettingsFor(hostId?: string | null): MachineSettings {
  return registry?.machineSettings(hostId || LOCAL_HOST_ID) ?? { claudeBinary: "", codexBinary: "" };
}
