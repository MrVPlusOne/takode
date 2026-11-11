import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const execFilePromise = promisify(execFileCb);

/**
 * Claude Code's stored logins on this machine (its own OAuth and the OAuth
 * logins of its MCP servers, under `mcpOAuth`): `~/.claude/.credentials.json`
 * on Linux and Windows, the "Claude Code-credentials" Keychain item on macOS.
 * Null when there is none or it cannot be read.
 */
export async function readClaudeCredentialStore(): Promise<{
  raw: string;
  parsed: Record<string, unknown>;
} | null> {
  try {
    if (process.platform !== "darwin") {
      const home = process.env.USERPROFILE || process.env.HOME || homedir() || "";
      const credPath = join(home, ".claude", ".credentials.json");
      try {
        await access(credPath);
      } catch {
        return null;
      }
      const raw = await readFile(credPath, "utf-8");
      return { raw, parsed: JSON.parse(raw) };
    }

    const raw = getStdoutString(
      await execFilePromise("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        encoding: "utf-8",
        timeout: 5000,
      }),
    ).trim();
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "hex").toString("utf-8");
    return { raw: decoded, parsed: JSON.parse(decoded) };
  } catch {
    return null;
  }
}

function getStdoutString(result: unknown): string {
  if (typeof result === "string") return result;
  if (Buffer.isBuffer(result)) return result.toString("utf-8");
  const stdout = result && typeof result === "object" && "stdout" in result ? result.stdout : undefined;
  if (typeof stdout === "string") return stdout;
  if (Buffer.isBuffer(stdout)) return stdout.toString("utf-8");
  return "";
}
