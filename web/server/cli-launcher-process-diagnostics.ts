import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(execCb);

export async function captureProcessSnapshot(pid: number): Promise<string[]> {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const cmd =
    `PARENT_PID="$(ps -o ppid= -p ${pid} 2>/dev/null | tr -d ' ')"; ` +
    `CHILD_PIDS="$(pgrep -P ${pid} 2>/dev/null | tr '\\n' ' ')"; ` +
    `IDS="${pid}"; ` +
    `[ -n "$PARENT_PID" ] && IDS="$IDS $PARENT_PID"; ` +
    `[ -n "$CHILD_PIDS" ] && IDS="$IDS $CHILD_PIDS"; ` +
    `ps -o pid=,ppid=,pgid=,stat=,etime=,command= -p $IDS 2>/dev/null`;
  try {
    const { stdout } = await execPromise(cmd, { timeout: 3000, maxBuffer: 64 * 1024 });
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function sanitizeSpawnArgsForLog(args: string[]): string {
  const secretKeyPattern = /(token|key|secret|password)/i;
  const out = [...args];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== "-e" || i + 1 >= out.length) continue;
    const envPair = out[i + 1];
    const eqIdx = envPair.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = envPair.slice(0, eqIdx);
    if (secretKeyPattern.test(key)) out[i + 1] = `${key}=***`;
  }
  return out.join(" ");
}
