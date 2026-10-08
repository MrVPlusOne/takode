import { Readable } from "node:stream";
import type { Subprocess } from "bun";
import type { RemoteProcess } from "./host-link-manager.js";

/**
 * Present a process running on a remote host in the shape of a Bun
 * `Subprocess`, which the Codex adapter and launcher are written against.
 *
 * `pid` is undefined: a host's process ids mean nothing on this machine, so
 * code that signals or probes local pids skips remote processes, and stopping
 * them goes through `kill`, which the host carries out.
 */
export function remoteSubprocess(proc: RemoteProcess): Subprocess {
  const exited = new Promise<number>((resolve) => proc.once("exit", (code: number | null) => resolve(code ?? 1)));
  return {
    pid: undefined,
    stdin: {
      write(data: string | Uint8Array): number {
        const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
        proc.stdin.write(buffer);
        return buffer.length;
      },
      flush() {
        return 0;
      },
      end() {
        proc.stdin.end();
        return 0;
      },
    },
    stdout: Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(proc.stderr) as unknown as ReadableStream<Uint8Array>,
    exited,
    get exitCode() {
      return proc.exitCode;
    },
    get killed() {
      return proc.killed;
    },
    kill(signal?: NodeJS.Signals | number) {
      proc.kill(typeof signal === "string" ? signal : "SIGTERM");
    },
  } as unknown as Subprocess;
}
