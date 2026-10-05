import type { Subprocess } from "bun";
import type { SdkSessionInfo } from "./session-info.js";
import { recordCodexProcessTermination } from "./codex-close-diagnostics.js";
import { sessionTag } from "./session-tag.js";

export async function terminateKnownProcess(
  sessionId: string,
  session: SdkSessionInfo | undefined,
  pid: number | undefined,
  proc?: Subprocess,
  reason?: string,
): Promise<void> {
  if (!pid) return;

  try {
    recordCodexProcessTermination(session, pid, "SIGTERM", reason ?? "launcher.terminateKnownProcess");
    if (proc) {
      proc.kill("SIGTERM");
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {}

  if (!proc) {
    console.warn(
      `[cli-launcher] Sent SIGTERM to untracked persisted pid ${pid} for session ${sessionTag(sessionId)}` +
        `${reason ? ` (${reason})` : ""}; refusing SIGKILL without a live subprocess handle`,
    );
    return;
  }

  const exitedGracefully = await Promise.race([
    proc.exited.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  if (exitedGracefully) return;

  console.warn(
    `[cli-launcher] Process ${pid} for session ${sessionTag(sessionId)} did not exit after SIGTERM` +
      `${reason ? ` (${reason})` : ""}; escalating to SIGKILL`,
  );
  try {
    recordCodexProcessTermination(session, pid, "SIGKILL", reason ?? "launcher.terminateKnownProcess");
    process.kill(pid, "SIGKILL");
  } catch {}
  await waitForProcessExit(pid, 1000);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}
