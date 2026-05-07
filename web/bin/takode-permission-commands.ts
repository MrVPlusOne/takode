import {
  CLAUDE_PERMISSION_MODES,
  deriveCodexPermissionMode,
  resolveCodexPermissionProfile,
  type ClaudePermissionMode,
  type CodexPermissionMode,
} from "../shared/permission-modes.js";
import {
  assertKnownFlags,
  apiPost,
  err,
  fetchSessionInfo,
  formatInlineText,
  getCallerSessionId,
  type TakodeSessionInfo,
} from "./takode-core.js";

export async function handlePermission(base: string, args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "get") {
    await handlePermissionGet(base, args.slice(1));
    return;
  }
  if (subcommand === "set") {
    await handlePermissionSet(base, args.slice(1));
    return;
  }
  err("Usage: takode permission <get|set> ...");
}

export const PERMISSION_HELP = `Usage: takode permission <get|set> ...

Inspect or update a session's backend-native permission mode.

Subcommands:
  get <session>                 Show the current permission mode
  set <session> <mode>          Update the runtime permission mode

Codex modes:
  default, auto-review, full-access, custom

Claude modes:
  ${CLAUDE_PERMISSION_MODES.join(", ")}
`;

export const PERMISSION_GET_HELP = `Usage: takode permission get <session> [--json]

Show a session's current backend-native permission mode.
`;

export const PERMISSION_SET_HELP = `Usage: takode permission set <session> <mode> [--json]

Update a session's runtime permission mode.

Codex modes:
  default, auto-review, full-access, custom

Claude modes:
  ${CLAUDE_PERMISSION_MODES.join(", ")}
`;

async function handlePermissionGet(base: string, args: string[]): Promise<void> {
  const parsed = parsePermissionArgs(args, PERMISSION_GET_HELP, 1);
  const sessionRef = parsed.positionals[0];
  if (!sessionRef) err("Usage: takode permission get <session> [--json]");

  const info = await fetchSessionInfo(base, sessionRef);
  const details = buildPermissionDetails(info);
  if (parsed.jsonMode) {
    console.log(JSON.stringify(details, null, 2));
    return;
  }
  printPermissionDetails(details);
}

async function handlePermissionSet(base: string, args: string[]): Promise<void> {
  const parsed = parsePermissionArgs(args, PERMISSION_SET_HELP, 2);
  const sessionRef = parsed.positionals[0];
  const rawMode = parsed.positionals[1];
  if (!sessionRef || !rawMode) err("Usage: takode permission set <session> <mode> [--json]");

  const info = await fetchSessionInfo(base, sessionRef);
  const backend = resolvePermissionBackend(info);
  const mode = resolveRuntimePermissionMode(backend, rawMode);
  const response = (await apiPost(base, `/sessions/${encodeURIComponent(sessionRef)}/permission-mode`, {
    mode,
    leaderSessionId: getCallerSessionId(),
  })) as { ok: boolean; sessionId: string; permissionMode: string };
  const details = buildPermissionDetails({
    ...info,
    sessionId: response.sessionId || info.sessionId,
    permissionMode: response.permissionMode,
  });

  if (parsed.jsonMode) {
    console.log(JSON.stringify({ ok: response.ok, ...details }, null, 2));
    return;
  }
  printPermissionUpdated(details);
}

type PermissionBackend = "claude" | "codex";

type PermissionDetails = {
  sessionId: string;
  sessionNum: number | null;
  name: string | null;
  backendType: "claude" | "claude-sdk" | "codex";
  permissionMode: string | null;
  displayMode: string | null;
};

const PERMISSION_ALLOWED_FLAGS = new Set(["json"]);

function parsePermissionArgs(
  args: string[],
  usage: string,
  expectedPositionals: number,
): {
  jsonMode: boolean;
  positionals: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const key = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const value = equalsIndex === -1 ? true : raw.slice(equalsIndex + 1);
    if (!key) err(`Unknown option(s): ${arg}\n${usage}`);
    if (key === "json" && value !== true) err(`--json does not take a value.\n${usage}`);
    flags[key] = value;
  }

  assertKnownFlags(flags, PERMISSION_ALLOWED_FLAGS, usage);
  if (positionals.length > expectedPositionals) {
    const extra = positionals.slice(expectedPositionals).map((arg) => formatInlineText(arg));
    err(`Unexpected argument(s): ${extra.join(", ")}\n${usage}`);
  }
  return { jsonMode: flags.json === true, positionals };
}

function buildPermissionDetails(info: TakodeSessionInfo): PermissionDetails {
  const backendType = resolveSessionBackendType(info);
  const permissionMode = info.permissionMode ?? null;
  return {
    sessionId: info.sessionId,
    sessionNum: info.sessionNum ?? null,
    name: info.name ?? null,
    backendType,
    permissionMode,
    displayMode: backendType === "codex" ? deriveCodexPermissionMode(permissionMode) : permissionMode,
  };
}

function resolvePermissionBackend(info: TakodeSessionInfo): PermissionBackend {
  return resolveSessionBackendType(info) === "codex" ? "codex" : "claude";
}

function resolveRuntimePermissionMode(backend: PermissionBackend, rawMode: string): string {
  if (backend === "codex") return resolveCodexRuntimePermissionMode(rawMode);
  return resolveClaudeRuntimePermissionMode(rawMode);
}

function resolveSessionBackendType(info: TakodeSessionInfo): "claude" | "claude-sdk" | "codex" {
  const backendType = info.backendType || "claude";
  if (backendType === "claude" || backendType === "claude-sdk" || backendType === "codex") return backendType;
  err(`Unsupported backend for permission modes: ${backendType}`);
}

function resolveCodexRuntimePermissionMode(rawMode: string): string {
  const normalized = rawMode.trim();
  if (normalized.startsWith("codex-")) {
    if (
      normalized === "codex-default" ||
      normalized === "codex-auto-review" ||
      normalized === "codex-full-access" ||
      normalized === "codex-custom"
    ) {
      return normalized;
    }
    err(
      `Unsupported permission mode for codex session: ${rawMode}. Expected default, auto-review, full-access, or custom.`,
    );
  }

  if (
    normalized === "default" ||
    normalized === "auto-review" ||
    normalized === "full-access" ||
    normalized === "custom"
  ) {
    return resolveCodexPermissionProfile(normalized as CodexPermissionMode);
  }
  err(
    `Unsupported permission mode for codex session: ${rawMode}. Expected default, auto-review, full-access, or custom.`,
  );
}

function resolveClaudeRuntimePermissionMode(rawMode: string): ClaudePermissionMode {
  const normalized = rawMode.trim();
  if (CLAUDE_PERMISSION_MODES.includes(normalized as ClaudePermissionMode)) {
    return normalized as ClaudePermissionMode;
  }
  err(`Unsupported permission mode for claude session: ${rawMode}. Expected ${CLAUDE_PERMISSION_MODES.join(", ")}.`);
}

function printPermissionDetails(details: PermissionDetails): void {
  console.log(`${formatPermissionSessionLabel(details)} permission`);
  console.log(`Backend: ${formatInlineText(details.backendType)}`);
  console.log(`Permission: ${formatPermissionMode(details)}`);
}

function printPermissionUpdated(details: PermissionDetails): void {
  console.log(`${formatPermissionSessionLabel(details)} permission updated`);
  console.log(`Backend: ${formatInlineText(details.backendType)}`);
  console.log(`Permission: ${formatPermissionMode(details)}`);
}

function formatPermissionSessionLabel(details: PermissionDetails): string {
  const label = details.sessionNum !== null ? `#${details.sessionNum}` : details.sessionId;
  const name = details.name ? ` "${formatInlineText(details.name)}"` : "";
  return `${label}${name}`;
}

function formatPermissionMode(details: PermissionDetails): string {
  const mode = details.permissionMode ?? "unknown";
  if (details.backendType !== "codex" || details.displayMode === null || details.displayMode === mode) {
    return formatInlineText(mode);
  }
  return `${formatInlineText(details.displayMode)} (${formatInlineText(mode)})`;
}
