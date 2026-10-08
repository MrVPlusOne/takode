import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** A machine registered to run sessions for this coordinator. */
export interface RegisteredHost {
  id: string;
  /** Human-readable name chosen at registration, unique per coordinator. */
  name: string;
  createdAt: number;
}

interface StoredHost extends RegisteredHost {
  /** SHA-256 of the host token; the token itself is shown once at registration. */
  tokenSha256: string;
}

const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/**
 * Registry of remote hosts allowed to connect to this coordinator. Each host
 * authenticates with a random token issued once at registration; only its hash
 * is stored. Removing a host revokes its token.
 */
export class HostRegistry {
  private hosts: StoredHost[] | null = null;
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

  /** Register a host and return its token. The token cannot be recovered later. */
  async register(name: string): Promise<{ host: RegisteredHost; token: string }> {
    const trimmed = name.trim();
    if (!HOST_NAME.test(trimmed)) {
      throw new Error("Host names use letters, digits, '.', '_' or '-' and start with a letter or digit");
    }
    const hosts = await this.load();
    if (hosts.some((host) => host.name === trimmed)) throw new Error(`A host named ${trimmed} already exists`);
    const token = randomBytes(32).toString("base64url");
    const stored: StoredHost = { id: randomUUID(), name: trimmed, createdAt: Date.now(), tokenSha256: sha256(token) };
    hosts.push(stored);
    await this.persist();
    return { host: publicHost(stored), token };
  }

  async remove(id: string): Promise<boolean> {
    const hosts = await this.load();
    const index = hosts.findIndex((host) => host.id === id);
    if (index === -1) return false;
    hosts.splice(index, 1);
    await this.persist();
    return true;
  }

  /** The host a token belongs to, or null. */
  async authenticate(token: string): Promise<RegisteredHost | null> {
    const digest = Buffer.from(sha256(token), "hex");
    for (const host of await this.load()) {
      if (timingSafeEqual(digest, Buffer.from(host.tokenSha256, "hex"))) return publicHost(host);
    }
    return null;
  }

  private async load(): Promise<StoredHost[]> {
    if (this.hosts) return this.hosts;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf-8")) as { hosts?: StoredHost[] };
      this.hosts = Array.isArray(parsed.hosts) ? parsed.hosts : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.hosts = [];
    }
    return this.hosts;
  }

  private persist(): Promise<void> {
    const content = JSON.stringify({ hosts: this.hosts ?? [] }, null, 2);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
