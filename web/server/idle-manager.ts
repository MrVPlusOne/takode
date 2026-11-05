import { serverWorkAdmission } from "./server-work-admission.js";
import type { CliLauncher, SdkSessionInfo } from "./cli-launcher.js";
import { LOCAL_HOST_ID } from "../shared/host-protocol.js";
import type { WsBridge } from "./ws-bridge.js";

export function wakeIdleKilledSession(
  launcher: Pick<CliLauncher, "getSession">,
  sessionId: string,
  requestCliRelaunch?: (sessionId: string) => void,
): boolean {
  const launcherInfo = launcher.getSession(sessionId);
  if (!launcherInfo) return false;
  if (launcherInfo.state !== "exited" || !launcherInfo.killedByIdleManager) return false;
  launcherInfo.killedByIdleManager = false;
  console.log(`[idle-manager] Waking idle-killed session ${sessionId} for pending herd events`);
  requestCliRelaunch?.(sessionId);
  return true;
}

/**
 * Keeps each machine's live session processes within its keep-alive limit: when
 * more sessions there have a live process than its limit allows, the longest-idle
 * ones there are stopped (they start again on their next message). Mid-turn
 * sessions and ones waiting on a permission are never stopped. Each machine counts
 * only its own sessions, so a busy machine never stops sessions on another.
 */
export class IdleManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  /** `limitFor` gives a machine's limit (`local` for this one); 0 means no limit. */
  constructor(
    private launcher: CliLauncher,
    private wsBridge: WsBridge,
    private limitFor: (machineId: string) => number,
  ) {}

  start(intervalMs = 60_000): void {
    this.stop();
    this.timer = setInterval(() => {
      // Fire-and-forget — sweep is async but the interval doesn't need to wait.
      void this.sweep();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Enforce every machine's limit once. Returns the number of sessions stopped. */
  async sweep(): Promise<number> {
    if (serverWorkAdmission.isStopping()) return 0;
    const byMachine = new Map<string, SdkSessionInfo[]>();
    for (const session of this.launcher.listSessions()) {
      if (session.state === "exited" || session.archived) continue;
      const machineId = session.hostId || LOCAL_HOST_ID;
      byMachine.set(machineId, [...(byMachine.get(machineId) ?? []), session]);
    }
    let killed = 0;
    for (const [machineId, alive] of byMachine) {
      killed += await this.enforce(machineId, alive);
    }
    return killed;
  }

  private async enforce(machineId: string, alive: SdkSessionInfo[]): Promise<number> {
    const maxKeepAlive = this.limitFor(machineId);
    if (maxKeepAlive <= 0 || alive.length <= maxKeepAlive) return 0;

    // Sort non-busy sessions by lastActivityAt ascending (oldest first)
    const killable = alive
      .filter((s) => !this.isBusy(s.sessionId))
      .sort((a, b) => (a.lastActivityAt ?? a.createdAt) - (b.lastActivityAt ?? b.createdAt));

    const toKill = alive.length - maxKeepAlive;
    let killed = 0;

    for (let i = 0; i < Math.min(toKill, killable.length); i++) {
      if (serverWorkAdmission.isStopping()) break;
      const s = killable[i];
      const age = s.lastActivityAt ? `${Math.round((Date.now() - s.lastActivityAt) / 1000)}s ago` : "no activity";
      console.log(
        `[idle-manager] Killing session ${s.sessionId.slice(0, 8)} on ${machineId} (lastActivity: ${age}, name: ${s.name ?? "unnamed"})`,
      );
      // Mark session so the UI can show a less alarming indicator for idle kills
      s.killedByIdleManager = true;
      // Use bridge.killSession which handles both subprocess kills and SDK
      // adapter disconnects. Await to verify the kill succeeded.
      const success = await this.wsBridge.killSession(s.sessionId);
      if (success) {
        killed++;
      } else {
        console.warn(`[idle-manager] Failed to kill session ${s.sessionId.slice(0, 8)} — session may not exist`);
      }
    }

    if (killed > 0) {
      console.log(
        `[idle-manager] Killed ${killed} idle session(s) on ${machineId} to enforce its maxKeepAlive=${maxKeepAlive} (${alive.length} alive, ${killable.length} killable)`,
      );
    }
    return killed;
  }

  private isBusy(sessionId: string): boolean {
    const bridge = this.wsBridge as unknown as {
      getSession?: (
        sessionId: string,
      ) => { isGenerating?: boolean; pendingPermissions?: { size: number } } | null | undefined;
      isSessionBusy?: (sessionId: string) => boolean;
    };
    if (typeof bridge.getSession === "function") {
      const bridgeSession = bridge.getSession(sessionId);
      return !!(bridgeSession?.isGenerating || bridgeSession?.pendingPermissions?.size);
    }
    return bridge.isSessionBusy?.(sessionId) ?? false;
  }
}
