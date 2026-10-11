import { homedir } from "node:os";
import { join } from "node:path";
import { LOCAL_HOST_ID } from "./remote-host/host-registry.js";
import type { HostLinkManager } from "./remote-host/host-link-manager.js";
import { onMachine } from "./remote-host/host-operations.js";
import { takodeSkillSlugs } from "./skill-symlink.js";
import {
  readUserContentBundle,
  userContentStoreExists,
  userContentStoreIsEmpty,
  userContentStoreSignature,
  writeImportedUserContent,
} from "./user-content.js";
import type { UserContentInstallResult } from "./user-content-install.js";

/** The coordinator's store: `instructions/{all,claude,codex}.md` and `skills/{all,claude,codex}/<skill>/`. */
export function userContentRoot(): string {
  return join(homedir(), ".companion", "user-content");
}

/** A slow or unreachable machine must not hold a launch for the host link's full operation timeout. */
const SYNC_TIMEOUT_MS = 20_000;
const STORE_POLL_MS = 30_000;

export interface UserContentMachineStatus {
  /** Null for the coordinator's own machine. */
  hostId: string | null;
  at: number;
  result?: UserContentInstallResult;
  error?: string;
}

export interface UserContentStatus {
  storeRoot: string;
  /** Without a store nothing is delivered and no machine's files are touched. */
  storeExists: boolean;
  storeEmpty: boolean;
  machines: UserContentMachineStatus[];
}

interface HostAccess {
  links: Pick<HostLinkManager, "status" | "onStatusChange">;
  listHostIds: () => Promise<string[]>;
}

/**
 * Coordinator side of user content: delivers the store to each machine before
 * a session launches there, when a host connects, and whenever the store
 * changes, and runs the user-approved import and take-overs.
 */
export class UserContentService {
  private readonly statuses = new Map<string, UserContentMachineStatus>();
  private hosts: HostAccess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private signature: string | null | undefined;
  private readonly root: string;
  private readonly takodeSkills: () => Promise<string[]>;

  constructor(options: { root?: string; takodeSkills?: () => Promise<string[]> } = {}) {
    this.root = options.root ?? userContentRoot();
    this.takodeSkills = options.takodeSkills ?? (() => takodeSkillSlugs());
  }

  /** Watch the store and connecting hosts. */
  start(hosts: HostAccess): void {
    this.hosts = hosts;
    const online = new Map<string, boolean>();
    hosts.links.onStatusChange((status) => {
      if (status.hostId === LOCAL_HOST_ID) return; // this machine's node shares this machine's files
      const was = online.get(status.hostId) ?? false;
      online.set(status.hostId, status.online);
      if (status.online && !was) void this.syncMachine(status.hostId, "host connected");
    });
    if (this.timer) return;
    this.timer = setInterval(() => void this.checkForChanges(), STORE_POLL_MS);
    this.timer.unref?.();
    void this.checkForChanges();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Deliver to every connected machine when the store changed since the last check. */
  async checkForChanges(): Promise<void> {
    const signature = await userContentStoreSignature(this.root).catch(() => null);
    if (signature === this.signature) return;
    this.signature = signature;
    if (signature !== null) await this.syncAll("store changed");
  }

  async syncAll(reason: string): Promise<void> {
    const hostIds = (await this.hosts?.listHostIds().catch(() => [])) ?? [];
    const online = hostIds.filter((id) => id !== LOCAL_HOST_ID && this.hosts?.links.status(id).online);
    await Promise.all([null, ...online].map((hostId) => this.syncMachine(hostId, reason)));
  }

  /**
   * Bring one machine up to date. A remote host is first asked whether its
   * copy is current, so the content crosses the host link only after a change.
   * Failures are recorded and logged, never thrown, so a launch goes ahead.
   */
  async syncMachine(
    hostId: string | null | undefined,
    reason: string,
    options: { takeOver?: boolean } = {},
  ): Promise<UserContentInstallResult | null> {
    if (!(await userContentStoreExists(this.root))) return null;
    const key = hostId ?? null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${SYNC_TIMEOUT_MS} ms`)), SYNC_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([this.deliver(key, !!options.takeOver), timeout]);
      this.statuses.set(key ?? "", { hostId: key, at: Date.now(), result });
      logChanges(key, reason, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statuses.set(key ?? "", { hostId: key, at: Date.now(), error: message });
      console.warn(`[user-content] Could not deliver user content to ${machineLabel(key)} (${reason}): ${message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async deliver(hostId: string | null, takeOver: boolean): Promise<UserContentInstallResult> {
    const [bundle, takodeSkills] = await Promise.all([readUserContentBundle(this.root), this.takodeSkills()]);
    const request = { hash: bundle.hash, takodeSkills, takeOver };
    if (!hostId) return onMachine(null, "installUserContent", { ...request, content: bundle.content });
    const first = await onMachine(hostId, "installUserContent", { ...request, content: null });
    if (first.status !== "needs-files") return first;
    return onMachine(hostId, "installUserContent", { ...request, content: bundle.content });
  }

  async status(): Promise<UserContentStatus> {
    const storeExists = await userContentStoreExists(this.root);
    return {
      storeRoot: this.root,
      storeExists,
      storeEmpty: !storeExists || (await userContentStoreIsEmpty(this.root)),
      machines: [...this.statuses.values()],
    };
  }

  /**
   * The one-time import the user approves on a fresh install: copy a machine's
   * user-level instructions and skills into the empty store, let Takode manage
   * that machine's files (backing up what it replaces), then deliver to the
   * other connected machines, whose own files stay untouched until the user
   * approves a take-over there too.
   */
  async importFrom(hostId: string | null) {
    if (!(await userContentStoreIsEmpty(this.root))) {
      throw new Error("The user content store already has content; import only fills an empty store");
    }
    const collected = await onMachine(hostId, "collectUserContent", await this.takodeSkills());
    const imported = await writeImportedUserContent(collected, this.root);
    this.signature = await userContentStoreSignature(this.root);
    const result = await this.syncMachine(hostId, "import", { takeOver: true });
    void this.syncAll("import");
    return { ...imported, skipped: collected.skipped, result };
  }

  /** Replace the user's own files and skills on one machine with the store's, after the user approved it there. */
  takeOver(hostId: string | null): Promise<UserContentInstallResult | null> {
    return this.syncMachine(hostId, "take-over approved", { takeOver: true });
  }
}

function machineLabel(hostId: string | null): string {
  return hostId ? `host ${hostId}` : "this machine";
}

function logChanges(hostId: string | null, reason: string, result: UserContentInstallResult): void {
  const changed = result.instructionFiles.filter((file) => !["current", "absent", "unmanaged"].includes(file.state));
  const { linked, removed, takenOver, conflicts } = result.skills;
  if (!changed.length && !linked.length && !removed.length && !takenOver.length) return;
  const files = changed.map((file) => `${file.path} ${file.state}`).join(", ");
  console.log(
    `[user-content] ${machineLabel(hostId)} (${reason}): ${files || "instructions unchanged"}; ` +
      `skills linked ${linked.length}, removed ${removed.length}, taken over ${takenOver.length}, ` +
      `waiting for approval ${conflicts.length}`,
  );
}

/** The server's instance, started from the server bootstrap. */
export const userContentService = new UserContentService();
