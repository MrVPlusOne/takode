import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LOCAL_HOST_ID } from "./remote-host/host-registry.js";
import type { HostLinkManager } from "./remote-host/host-link-manager.js";
import { onMachine } from "./remote-host/host-operations.js";
import { takodeSkillSlugs } from "./skill-symlink.js";
import {
  type UserContentStore,
  type UserLevelSummary,
  readUserContentBundle,
  userContentStoreExists,
  userContentStoreIsEmpty,
  userContentStoreSignature,
  writeImportedUserContent,
} from "./user-content.js";
import type { UserContentInstallResult } from "./user-content-install.js";

/**
 * The coordinator's store: `user-instructions/{all,claude,codex}.md` and
 * `user-skills/{all,claude,codex}/<skill>/`. Either may be a link, for example
 * into a Git checkout of the user's instructions.
 */
export function userContentStore(home = homedir()): UserContentStore {
  return {
    instructions: join(home, ".companion", "user-instructions"),
    skills: join(home, ".companion", "user-skills"),
  };
}

/** A slow or unreachable machine must not hold a launch for the host link's full operation timeout. */
const SYNC_TIMEOUT_MS = 20_000;
const STORE_POLL_MS = 30_000;
/** Import previews read every machine's skills, so they are reused for a while. */
const SUMMARY_TTL_MS = 60_000;

export interface UserContentMachineStatus {
  /** Null for the coordinator's own machine. */
  hostId: string | null;
  at: number;
  result?: UserContentInstallResult;
  error?: string;
  /** Where this machine's most recent backup went, kept after later deliveries that back nothing up. */
  lastBackup?: { dir: string; at: number };
}

/** What an import from one machine would bring in, for choosing the machine to import from. */
export interface UserContentImportCandidate {
  hostId: string | null;
  summary?: UserLevelSummary;
  error?: string;
  /** Still being read from the machine. */
  pending?: boolean;
}

export interface UserContentStatus {
  store: UserContentStore;
  /** Without a store nothing is delivered and no machine's files are touched. */
  storeExists: boolean;
  storeEmpty: boolean;
  machines: UserContentMachineStatus[];
  /** Each connected machine's import preview; only while the store is empty. */
  importCandidates: UserContentImportCandidate[];
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
  private readonly store: UserContentStore;
  private readonly noticeFile: string;
  private readonly takodeSkills: () => Promise<string[]>;
  /** Import previews by machine (`""` for this one), kept for a minute. */
  private readonly candidates = new Map<string, { at: number; candidate: UserContentImportCandidate }>();
  private candidateRefresh: Promise<void> | null = null;

  constructor(options: { store?: UserContentStore; noticeFile?: string; takodeSkills?: () => Promise<string[]> } = {}) {
    this.store = options.store ?? userContentStore();
    this.noticeFile = options.noticeFile ?? join(homedir(), ".companion", "user-content-notice.json");
    this.takodeSkills = options.takodeSkills ?? (async () => takodeSkillSlugs());
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
    const signature = await userContentStoreSignature(this.store).catch(() => null);
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
    if (!(await userContentStoreExists(this.store))) return null;
    const key = hostId ?? null;
    try {
      const result = await withTimeout(this.deliver(key, !!options.takeOver));
      const previous = this.statuses.get(key ?? "")?.lastBackup;
      const lastBackup = result.backupDir ? { dir: result.backupDir, at: Date.now() } : previous;
      this.statuses.set(key ?? "", { hostId: key, at: Date.now(), result, ...(lastBackup ? { lastBackup } : {}) });
      logChanges(key, reason, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lastBackup = this.statuses.get(key ?? "")?.lastBackup;
      this.statuses.set(key ?? "", {
        hostId: key,
        at: Date.now(),
        error: message,
        ...(lastBackup ? { lastBackup } : {}),
      });
      console.warn(`[user-content] Could not deliver user content to ${machineLabel(key)} (${reason}): ${message}`);
      return null;
    }
  }

  private async deliver(hostId: string | null, takeOver: boolean): Promise<UserContentInstallResult> {
    const [bundle, takodeSkills] = await Promise.all([readUserContentBundle(this.store), this.takodeSkills()]);
    const request = { hash: bundle.hash, takodeSkills, takeOver };
    if (!hostId) return onMachine(null, "installUserContent", { ...request, content: bundle.content });
    const first = await onMachine(hostId, "installUserContent", { ...request, content: null });
    if (first.status !== "needs-files") return first;
    return onMachine(hostId, "installUserContent", { ...request, content: bundle.content });
  }

  async status(): Promise<UserContentStatus> {
    const storeExists = await userContentStoreExists(this.store);
    const storeEmpty = !storeExists || (await userContentStoreIsEmpty(this.store));
    return {
      store: this.store,
      storeExists,
      storeEmpty,
      machines: [...this.statuses.values()],
      importCandidates: storeEmpty ? await this.currentCandidates() : [],
    };
  }

  /**
   * Import previews as known now, without waiting: a machine still being read
   * shows as pending, so Settings can list every machine at once and fill in
   * each preview as it arrives. A refresh starts when previews are missing or a
   * minute old.
   */
  private async currentCandidates(): Promise<UserContentImportCandidate[]> {
    const machines = await this.onlineMachines();
    const stale = machines.some((hostId) => {
      const known = this.candidates.get(hostId ?? "");
      return !known || Date.now() - known.at > SUMMARY_TTL_MS;
    });
    if (stale) void this.refreshCandidates(machines);
    return machines.map((hostId) => {
      const known = this.candidates.get(hostId ?? "");
      return known ? known.candidate : { hostId, pending: true };
    });
  }

  /** Read each machine's import preview; each result is kept as soon as it arrives. */
  private refreshCandidates(machines: (string | null)[]): Promise<void> {
    this.candidateRefresh ??= (async () => {
      const takodeSkills = await this.takodeSkills();
      await Promise.all(
        machines.map(async (hostId) => {
          let candidate: UserContentImportCandidate;
          try {
            candidate = { hostId, summary: await withTimeout(onMachine(hostId, "summarizeUserContent", takodeSkills)) };
          } catch (error) {
            candidate = { hostId, error: error instanceof Error ? error.message : String(error) };
          }
          this.candidates.set(hostId ?? "", { at: Date.now(), candidate });
        }),
      );
    })().finally(() => {
      this.candidateRefresh = null;
    });
    return this.candidateRefresh;
  }

  private async onlineMachines(): Promise<(string | null)[]> {
    const hostIds = (await this.hosts?.listHostIds().catch(() => [])) ?? [];
    return [null, ...hostIds.filter((id) => id !== LOCAL_HOST_ID && this.hosts?.links.status(id).online)];
  }

  /**
   * Whether to show the one-time notice after an upgrade: the store is empty,
   * some machine has user-level instructions or skills to import, and the user
   * has not dismissed the notice.
   */
  async notice(): Promise<{ show: boolean }> {
    if (await this.noticeDismissed()) return { show: false };
    if (!(await userContentStoreIsEmpty(this.store))) return { show: false };
    const machines = await this.onlineMachines();
    if (machines.some((hostId) => !this.candidates.has(hostId ?? ""))) await this.refreshCandidates(machines);
    const show = [...this.candidates.values()].some(
      ({ candidate: { summary } }) => summary && (summary.claudeChars || summary.codexChars || summary.skills.length),
    );
    return { show };
  }

  async dismissNotice(): Promise<void> {
    await mkdir(dirname(this.noticeFile), { recursive: true });
    await writeFile(this.noticeFile, `${JSON.stringify({ dismissedAt: Date.now() })}\n`);
  }

  private async noticeDismissed(): Promise<boolean> {
    return readFile(this.noticeFile, "utf-8").then(
      () => true,
      () => false,
    );
  }

  /**
   * The one-time import the user approves on a fresh install: copy a machine's
   * user-level instructions and skills into the empty store, let Takode manage
   * that machine's files (backing up what it replaces), then deliver to the
   * other connected machines, whose own files stay untouched until the user
   * approves a take-over there too.
   */
  async importFrom(hostId: string | null) {
    if (!(await userContentStoreIsEmpty(this.store))) {
      throw new Error("The user content store already has content; import only fills an empty store");
    }
    const collected = await onMachine(hostId, "collectUserContent", await this.takodeSkills());
    const imported = await writeImportedUserContent(collected, this.store);
    this.signature = await userContentStoreSignature(this.store);
    this.candidates.clear();
    const result = await this.syncMachine(hostId, "import", { takeOver: true });
    void this.syncAll("import");
    return { ...imported, skipped: collected.skipped, result };
  }

  /** Move the named skills (and, if asked, links that point nowhere) out of one machine's skill folders, with backups. */
  retireSkills(hostId: string | null, skills: string[], dangling: boolean) {
    return this.takodeSkills().then((takodeSkills) =>
      withTimeout(onMachine(hostId, "retireUserSkills", { skills, dangling, takodeSkills })),
    );
  }

  /** Replace the user's own files and skills on one machine with the store's, after the user approved it there. */
  takeOver(hostId: string | null): Promise<UserContentInstallResult | null> {
    return this.syncMachine(hostId, "take-over approved", { takeOver: true });
  }
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${SYNC_TIMEOUT_MS} ms`)), SYNC_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
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
