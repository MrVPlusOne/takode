import { exec as execCallback } from "node:child_process";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { HostRequest, HostResponse } from "../../shared/host-protocol.js";
import type { HostLinkManager } from "./host-link-manager.js";

const execLocal = promisify(execCallback);

/** Node's default `exec` output cap, kept for remote commands too. */
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
/** Extra time for the round trip on top of a remote command's own timeout. */
const LINK_ALLOWANCE_MS = 10_000;

export interface MachineFileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  mtimeMs: number;
}

/**
 * The machine a session's files and processes live on. Code that inspects a
 * session's working directory (Git state, diffs, file previews, attachments)
 * goes through the session's machine, so it works the same whether the
 * session runs here or on a registered remote host.
 */
export interface Machine {
  /** Run a shell command. Rejects on a non-zero exit with `code`, `stdout` and `stderr` on the error, like `exec`. */
  exec(
    command: string,
    options: { cwd: string; timeout?: number; maxBuffer?: number },
  ): Promise<{ stdout: string; stderr: string }>;
  /** Read up to `maxBytes` of a file (all of it by default). Rejects if it does not exist. */
  readFile(path: string, maxBytes?: number): Promise<Buffer>;
  /** File metadata, or null when nothing exists at the path. */
  stat(path: string): Promise<MachineFileStat | null>;
  /** Write a file, creating missing parent directories. */
  writeFile(path: string, data: Buffer, mode?: number): Promise<void>;
}

export const localMachine: Machine = {
  async exec(command, options) {
    const { stdout, stderr } = await execLocal(command, {
      cwd: options.cwd,
      encoding: "utf-8",
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });
    return { stdout, stderr };
  },
  async readFile(path, maxBytes) {
    const handle = await open(path, "r");
    try {
      const size = (await handle.stat()).size;
      const length = maxBytes === undefined ? size : Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return buffer;
    } finally {
      await handle.close();
    }
  },
  async stat(path) {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    return info
      ? { size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs }
      : null;
  },
  async writeFile(path, data, mode) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, mode === undefined ? undefined : { mode });
  },
};

let hostLinks: HostLinkManager | null = null;

/** Called once at server startup so sessions on remote hosts resolve to those hosts. */
export function configureRemoteMachines(links: HostLinkManager | null): void {
  hostLinks = links;
}

/** Whether a remote host's link is up. */
export function hostIsOnline(hostId: string): boolean {
  return hostLinks?.status(hostId).online ?? false;
}

/** Whether a remote host is reachable and reports a usable network of its own. */
export function hostHasUsableNetwork(hostId: string): boolean {
  return hostLinks?.hasUsableNetwork(hostId) ?? false;
}

/** Send a one-shot request to a remote host; rejects with `HostUnavailableError` while it is offline. */
export function requestOnHost<K extends HostRequest["kind"]>(
  hostId: string,
  request: Extract<HostRequest, { kind: K }>,
  timeoutMs: number,
): Promise<Extract<HostResponse, { kind: K }>> {
  if (!hostLinks) throw new Error(`Remote hosts are not available on this server; cannot reach host ${hostId}`);
  return hostLinks.request(hostId, request, timeoutMs);
}

/** The machine for a session: its remote host when it has one, otherwise this machine. */
export function machineFor(hostId: string | null | undefined): Machine {
  if (!hostId) return localMachine;
  const links = hostLinks;
  if (!links) throw new Error(`Remote hosts are not available on this server; cannot reach host ${hostId}`);
  return remoteMachine(links, hostId);
}

function remoteMachine(links: HostLinkManager, hostId: string): Machine {
  return {
    async exec(command, options) {
      const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
      const result = await links.request(
        hostId,
        { kind: "exec", command, cwd: options.cwd, timeoutMs, maxOutputBytes },
        timeoutMs + LINK_ALLOWANCE_MS,
      );
      if (result.truncated || result.code !== 0) {
        const reason = result.truncated
          ? "output exceeded maxBuffer"
          : result.signal
            ? `killed by ${result.signal}`
            : `exit code ${result.code}`;
        throw Object.assign(new Error(`Command failed on host (${reason}): ${command}`), {
          code: result.code,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
      return { stdout: result.stdout, stderr: result.stderr };
    },
    async readFile(path, maxBytes) {
      const result = await links.request(
        hostId,
        { kind: "read_file", path, maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER },
        DEFAULT_TIMEOUT_MS,
      );
      return Buffer.from(result.data, "base64");
    },
    async stat(path) {
      return (await links.request(hostId, { kind: "stat", path }, DEFAULT_TIMEOUT_MS)).stat;
    },
    async writeFile(path, data, mode) {
      await links.request(
        hostId,
        { kind: "write_file", path, data: data.toString("base64"), ...(mode === undefined ? {} : { mode }) },
        DEFAULT_TIMEOUT_MS,
      );
    },
  };
}
