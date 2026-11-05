import { LOCAL_HOST_ID } from "../shared/host-protocol.js";
import { Caffeinate } from "./caffeinate.js";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";

/**
 * Keeps each Mac awake while one of its own sessions is mid-turn, as each
 * machine's "keep awake" setting allows (on unless turned off).
 *
 * Polls every 60s. For every machine with a session generating, it restarts
 * that machine's countdown of the grace period: this machine with
 * `caffeinate` here, a remote host by asking its `takode node` to (which does
 * it only on macOS). When the turns end the countdown runs out, so the machine
 * may sleep a grace period later.
 */
export class SleepInhibitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly caffeinate: Caffeinate;

  constructor(
    private readonly deps: {
      wsBridge: Pick<WsBridge, "getSession">;
      launcher: Pick<CliLauncher, "listSessions">;
      getSettings: () => { sleepInhibitorDurationMinutes: number };
      /** Whether a machine (`local` for this one) may be kept awake. */
      keepAwakeOn: (machineId: string) => boolean;
      /** Ask a remote host's node to stay awake this many seconds. */
      keepHostAwake: (hostId: string, seconds: number) => void;
      caffeinate?: Caffeinate;
    },
  ) {
    this.caffeinate = deps.caffeinate ?? new Caffeinate();
  }

  start(intervalMs = 60_000): void {
    if (this.intervalHandle !== null) return;
    this.sweep();
    this.intervalHandle = setInterval(() => this.sweep(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.caffeinate.stop();
  }

  /** Visible for testing. */
  sweep(): void {
    if (!this.deps.keepAwakeOn(LOCAL_HOST_ID)) this.caffeinate.stop();
    const seconds = this.deps.getSettings().sleepInhibitorDurationMinutes * 60;
    for (const machineId of this.machinesWithTurns()) {
      if (!this.deps.keepAwakeOn(machineId)) continue;
      if (machineId === LOCAL_HOST_ID) this.caffeinate.keepAwakeFor(seconds);
      else this.deps.keepHostAwake(machineId, seconds);
    }
  }

  private machinesWithTurns(): Set<string> {
    const machines = new Set<string>();
    for (const info of this.deps.launcher.listSessions()) {
      if (info.state === "exited") continue;
      if (this.deps.wsBridge.getSession(info.sessionId)?.isGenerating) machines.add(info.hostId || LOCAL_HOST_ID);
    }
    return machines;
  }
}
