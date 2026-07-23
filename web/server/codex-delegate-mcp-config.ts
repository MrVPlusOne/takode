import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const takodeDelegateMcpServerName = "takode_delegate";
const serverDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.__COMPANION_PACKAGE_ROOT
  ? resolve(process.env.__COMPANION_PACKAGE_ROOT)
  : resolve(serverDir, "..");
const takodeDelegateMcpScriptPath = join(packageRoot, "bin", "takode-delegate-mcp.ts");

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function renderTomlStringArray(values: string[]): string {
  return "[" + values.map(tomlString).join(", ") + "]";
}

function removeTomlSection(configToml: string, sectionName: string): string {
  const lines = configToml.split("\n");
  const out: string[] = [];
  let skipping = false;
  const sectionHeader = "[" + sectionName + "]";
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]\s*$/.test(trimmed)) {
      skipping = trimmed === sectionHeader;
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function upsertTakodeDelegateMcpServer(
  configToml: string,
  options: {
    enabled: boolean;
    command: string;
    args: string[];
    env: Record<string, string>;
  },
): string {
  let next = removeTomlSection(configToml, "mcp_servers." + takodeDelegateMcpServerName);
  next = removeTomlSection(next, "mcp_servers." + takodeDelegateMcpServerName + ".env");
  if (!options.enabled) return next;
  if (next.trim() && !next.endsWith("\n")) next += "\n";
  if (next.trim()) next += "\n";
  next += "[mcp_servers." + takodeDelegateMcpServerName + "]\n";
  next += "command = " + tomlString(options.command) + "\n";
  next += "args = " + renderTomlStringArray(options.args) + "\n";
  next += "enabled = true\n";
  next += "[mcp_servers." + takodeDelegateMcpServerName + ".env]\n";
  for (const [key, value] of Object.entries(options.env).sort(([a], [b]) => a.localeCompare(b))) {
    next += key + " = " + tomlString(value) + "\n";
  }
  return next;
}

export function buildTakodeDelegateMcpConfig(
  enabled: boolean,
  env: Record<string, string | undefined> | undefined,
): { enabled: boolean; command: string; args: string[]; env: Record<string, string> } {
  const selectedEnv: Record<string, string> = {};
  for (const key of [
    "COMPANION_PORT",
    "COMPANION_SESSION_ID",
    "COMPANION_SESSION_NUMBER",
    "COMPANION_AUTH_TOKEN",
    "COMPANION_SERVER_ID",
    "COMPANION_SERVER_SLUG",
    "COMPANION_MEMORY_SPACE_SLUG",
    "TAKODE_ROLE",
    "TAKODE_API_PORT",
    "TAKODE_DELEGATE_ROLE",
    "TAKODE_DELEGATE_ID",
    "TAKODE_DELEGATE_PARENT_SESSION_ID",
  ]) {
    const value = env?.[key];
    if (typeof value === "string" && value.length > 0) selectedEnv[key] = value;
  }
  return {
    enabled,
    command: process.execPath,
    args: [takodeDelegateMcpScriptPath],
    env: selectedEnv,
  };
}
