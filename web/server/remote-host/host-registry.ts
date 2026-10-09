import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LOCAL_HOST_ID, type HostMachineSettings } from "../../shared/host-protocol.js";
import { machineNameError } from "../machine-identity.js";

/** A machine registered to run sessions for this coordinator. */
export interface RegisteredHost {
  id: string;
  /**
   * The machine's name, unique per coordinator: chosen at registration, then
   * the name the machine itself reports (see `machine-identity.ts`).
   */
  name: string;
  createdAt: number;
}

/**
 * Settings that belong to one machine rather than to the server: the agent
 * CLIs that machine runs. An empty value means the CLI's own name, found on
 * that machine's PATH.
 */
export type MachineSettings = HostMachineSettings;

export { LOCAL_HOST_ID } from "../../shared/host-protocol.js";

/**
 * The host whose `takode node` runs a session's current process, which then
 * outlives a coordinator restart: the session's remote host, or this
 * machine's own node for a session without a host that it runs (one with a
 * saved host process id). Undefined for a process the coordinator started itself.
 */
export function processHostOf(session: { hostId?: string; hostProcId?: string }): string | undefined {
  return session.hostId ?? (session.hostProcId ? LOCAL_HOST_ID : undefined);
}

const DEFAULT_MACHINE_SETTINGS: MachineSettings = { claudeBinary: "", codexBinary: "" };

interface StoredHost extends RegisteredHost {
  /** SHA-256 of the host token; the token itself is shown once at registration. */
  tokenSha256: string;
  settings?: MachineSettings;
}

interface StoredRegistry {
  hosts: StoredHost[];
  /** Settings of the coordinator's own machine. Absent until first written, which also marks the legacy migration as done. */
  local?: {
    settings: MachineSettings;
    /** SHA-256 of the token this machine's node presents. */
    nodeTokenSha256?: string;
  };
}

/**
 * Registry of remote hosts allowed to connect to this coordinator. Each host
 * authenticates with a random token issued once at registration; only its hash
 * is stored. Removing a host revokes its token.
 */
export class HostRegistry {
  private hosts: StoredHost[] | null = null;
  private local: StoredRegistry["local"];
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** Registry for one coordinator, kept apart from other servers sharing the same HOME. */
  static forServer(serverId: string): HostRegistry {
    return new HostRegistry(join(homedir(), ".companion", "hosts", `${serverId}.json`));
  }

  async list(): Promise<RegisteredHost[]> {
    return (await this.load()).map(publicHost);
  }

  async get(id: string): Promise<RegisteredHost | null> {
    const host = (await this.load()).find((candidate) => candidate.id === id);
    return host ? publicHost(host) : null;
  }

  /**
   * Register a host and return its token. The token cannot be recovered later.
   * `reserved` names other machines that are not registered hosts (this machine).
   */
  async register(name: string, reserved: string[] = []): Promise<{ host: RegisteredHost; token: string }> {
    const trimmed = name.trim();
    const hosts = await this.load();
    const problem = this.nameProblem(trimmed, null, reserved);
    if (problem) throw new Error(problem);
    const token = randomBytes(32).toString("base64url");
    const stored: StoredHost = { id: randomUUID(), name: trimmed, createdAt: Date.now(), tokenSha256: sha256(token) };
    hosts.push(stored);
    await this.persist();
    return { host: publicHost(stored), token };
  }

  /** A host's name from memory once the registry has loaded; null for unknown hosts. */
  nameOf(id: string): string | null {
    return this.hosts?.find((host) => host.id === id)?.name ?? null;
  }

  /**
   * Rename a host. `reserved` names other machines that are not registered
   * hosts (this machine). Throws for an invalid or taken name; returns false
   * for an unknown host.
   */
  async rename(id: string, name: string, reserved: string[] = []): Promise<boolean> {
    const host = (await this.load()).find((candidate) => candidate.id === id);
    if (!host) return false;
    const problem = this.nameProblem(name, id, reserved);
    if (problem) throw new Error(problem);
    host.name = name;
    await this.persist();
    return true;
  }

  /**
   * Settle a connecting host's name: a machine keeps the name it already has,
   * so the registry takes it unless it is invalid or taken. Synchronous, for
   * the link handshake; the registry has loaded by then (the host authenticated).
   * Returns the name the host goes by.
   */
  adoptReportedName(id: string, reported: string | null, reserved: string[] = []): string | null {
    const host = this.hosts?.find((candidate) => candidate.id === id);
    if (!host) return null;
    if (!reported || reported === host.name) return host.name;
    const problem = this.nameProblem(reported, id, reserved);
    if (problem) {
      console.warn(`[host-registry] Host ${host.name} reports the name ${reported}, which is not usable: ${problem}`);
      return host.name;
    }
    console.log(`[host-registry] Host ${host.name} goes by its own machine name ${reported}`);
    host.name = reported;
    void this.persist().catch((error) => console.error("[host-registry] Saving a host name failed:", error));
    return reported;
  }

  /**
   * Machine settings of a host (`LOCAL_HOST_ID` for this machine). Answers
   * from memory once the registry has loaded, so launches can read it
   * synchronously; before that, and for unknown hosts, the defaults.
   */
  machineSettings(hostId: string): MachineSettings {
    const stored =
      hostId === LOCAL_HOST_ID ? this.local?.settings : this.hosts?.find((host) => host.id === hostId)?.settings;
    return { ...DEFAULT_MACHINE_SETTINGS, ...stored };
  }

  /** Issue a new token for this machine's node, replacing any earlier one. */
  async issueLocalNodeToken(): Promise<string> {
    await this.load();
    const token = randomBytes(32).toString("base64url");
    this.local = { ...this.localEntry(), nodeTokenSha256: sha256(token) };
    await this.persist();
    return token;
  }

  /** Change some of a host's machine settings. Returns null for an unknown host. */
  async updateMachineSettings(hostId: string, patch: Partial<MachineSettings>): Promise<MachineSettings | null> {
    const hosts = await this.load();
    const next = { ...this.machineSettings(hostId), ...definedSettings(patch) };
    if (hostId === LOCAL_HOST_ID) {
      this.local = { ...this.localEntry(), settings: next };
    } else {
      const host = hosts.find((candidate) => candidate.id === hostId);
      if (!host) return null;
      host.settings = next;
    }
    await this.persist();
    return next;
  }

  /**
   * Adopt the Claude/Codex settings that used to be global server settings as
   * this machine's settings, unless this machine already has settings.
   * Returns whether `legacy` is now what this machine has stored, moved now
   * or identical to it, so the caller may drop the old copy. It is false when
   * there is nothing to move, or when this machine already has different
   * settings: for example moved earlier from another port's settings file of
   * the same server, since settings files are per port but this registry is
   * per server. The old copy must then stay where it is.
   */
  async adoptLegacyLocalSettings(legacy: MachineSettings | null): Promise<boolean> {
    await this.load();
    if (!legacy) return false;
    const settings = { ...DEFAULT_MACHINE_SETTINGS, ...definedSettings(legacy) };
    if (this.local) {
      return (
        this.local.settings.claudeBinary === settings.claudeBinary &&
        this.local.settings.codexBinary === settings.codexBinary
      );
    }
    this.local = { settings };
    await this.persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const hosts = await this.load();
    const index = hosts.findIndex((host) => host.id === id);
    if (index === -1) return false;
    hosts.splice(index, 1);
    await this.persist();
    return true;
  }

  /** The host a token belongs to (`LOCAL_HOST_ID` for this machine's node), or null. */
  async authenticate(token: string): Promise<RegisteredHost | null> {
    const digest = Buffer.from(sha256(token), "hex");
    for (const host of await this.load()) {
      if (timingSafeEqual(digest, Buffer.from(host.tokenSha256, "hex"))) return publicHost(host);
    }
    const localDigest = this.local?.nodeTokenSha256;
    if (localDigest && timingSafeEqual(digest, Buffer.from(localDigest, "hex"))) {
      return { id: LOCAL_HOST_ID, name: LOCAL_HOST_ID, createdAt: 0 };
    }
    return null;
  }

  /** Read the registry from disk; later reads answer from memory. */
  async load(): Promise<StoredHost[]> {
    if (this.hosts) return this.hosts;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf-8")) as Partial<StoredRegistry>;
      this.hosts = Array.isArray(parsed.hosts) ? parsed.hosts : [];
      // `nodeEnabled` was the switch for running this machine's sessions under
      // its own node, which they now always do; it is dropped at the next save.
      const { nodeEnabled: _retired, ...local } = (parsed.local ?? {}) as NonNullable<StoredRegistry["local"]> & {
        nodeEnabled?: boolean;
      };
      this.local = local.settings ? local : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.hosts = [];
    }
    return this.hosts;
  }

  private localEntry(): NonNullable<StoredRegistry["local"]> {
    return this.local ?? { settings: { ...DEFAULT_MACHINE_SETTINGS } };
  }

  private nameProblem(name: string, id: string | null, reserved: string[] = []): string | null {
    const invalid = machineNameError(name);
    if (invalid) return invalid;
    const taken = reserved.includes(name) || (this.hosts ?? []).some((host) => host.name === name && host.id !== id);
    return taken ? `A machine named ${name} already exists` : null;
  }

  private persist(): Promise<void> {
    const registry: StoredRegistry = { hosts: this.hosts ?? [], ...(this.local ? { local: this.local } : {}) };
    const content = JSON.stringify(registry, null, 2);
    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, content, { encoding: "utf-8", mode: 0o600 });
      await rename(temp, this.path);
    });
    return this.pendingWrite;
  }
}

function publicHost({ id, name, createdAt }: StoredHost): RegisteredHost {
  return { id, name, createdAt };
}

/** The string fields of a settings patch, trimmed. */
function definedSettings(patch: Partial<MachineSettings>): Partial<MachineSettings> {
  const defined: Partial<MachineSettings> = {};
  if (typeof patch.claudeBinary === "string") defined.claudeBinary = patch.claudeBinary.trim();
  if (typeof patch.codexBinary === "string") defined.codexBinary = patch.codexBinary.trim();
  return defined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
