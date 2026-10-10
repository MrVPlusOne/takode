/**
 * Finds the processes listening on a local TCP port. Uses `lsof` when it is
 * installed (macOS and most Linux desktops) and falls back to `ss` (iproute2),
 * which minimal Linux machines ship without `lsof`. Like `lsof` without root,
 * `ss` only reports the processes of the current user.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function listeningPids(port: number, env: NodeJS.ProcessEnv = process.env): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { env });
    return uniquePids(stdout.split("\n").filter(Boolean).map(Number));
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    // lsof exits 1 with no output when nothing listens.
    if (code === 1) return [];
    if (code !== "ENOENT") throw err;
  }
  try {
    const { stdout } = await execFileAsync("ss", ["-ltnp", `( sport = :${port} )`], { env });
    return parseSsPids(stdout);
  } catch (err) {
    if ((err as { code?: number | string }).code === "ENOENT") {
      throw new Error(`Cannot check port ${port}: neither lsof nor ss is installed.`);
    }
    throw err;
  }
}

/**
 * Reads the PIDs from `ss -p` output, whose process column looks like
 * `users:(("bun",pid=123,fd=11),("bun",pid=124,fd=11))`. A process listening on
 * both IPv4 and IPv6 appears on two lines but is reported once.
 */
export function parseSsPids(output: string): number[] {
  return uniquePids([...output.matchAll(/\bpid=(\d+)/g)].map((match) => Number(match[1])));
}

function uniquePids(pids: number[]): number[] {
  return [...new Set(pids)];
}
