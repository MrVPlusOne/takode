export const CLAUDE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "delegate",
  "dontAsk",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

export const CODEX_PERMISSION_PROFILES = [
  "codex-default",
  "codex-auto-review",
  "codex-full-access",
  "codex-custom",
] as const;

export type CodexPermissionProfile = (typeof CODEX_PERMISSION_PROFILES)[number];

export type CodexPermissionMode = "default" | "auto-review" | "full-access" | "custom";

export function isClaudePermissionMode(mode: string): mode is ClaudePermissionMode {
  return CLAUDE_PERMISSION_MODES.includes(mode as ClaudePermissionMode);
}

export function isCodexPermissionProfile(mode: string | null | undefined): mode is CodexPermissionProfile {
  return CODEX_PERMISSION_PROFILES.includes(mode as CodexPermissionProfile);
}

export function normalizeClaudePermissionMode(raw: string | null | undefined): ClaudePermissionMode {
  return raw && isClaudePermissionMode(raw) ? raw : "default";
}

export function normalizeCodexPermissionProfile(
  raw: string | null | undefined,
  fallback: CodexPermissionProfile = "codex-default",
): CodexPermissionProfile {
  if (!raw) return fallback;
  switch (raw) {
    case "codex-default":
    case "suggest":
    case "acceptEdits":
    case "default":
    case "plan":
      return "codex-default";
    case "codex-auto-review":
      return "codex-auto-review";
    case "codex-full-access":
    case "bypassPermissions":
      return "codex-full-access";
    case "codex-custom":
      return "codex-custom";
    default:
      return fallback;
  }
}

export function resolveCodexPermissionProfile(mode: CodexPermissionMode): CodexPermissionProfile {
  switch (mode) {
    case "default":
      return "codex-default";
    case "auto-review":
      return "codex-auto-review";
    case "full-access":
      return "codex-full-access";
    case "custom":
      return "codex-custom";
  }
}

export function deriveCodexPermissionMode(profile: string | null | undefined): CodexPermissionMode {
  switch (normalizeCodexPermissionProfile(profile)) {
    case "codex-auto-review":
      return "auto-review";
    case "codex-full-access":
      return "full-access";
    case "codex-custom":
      return "custom";
    case "codex-default":
      return "default";
  }
}

export function deriveAskPermissionForMode(backend: "claude" | "codex", permissionMode: string): boolean {
  if (backend === "codex") return normalizeCodexPermissionProfile(permissionMode) !== "codex-full-access";
  const claudeMode = normalizeClaudePermissionMode(permissionMode);
  return claudeMode !== "bypassPermissions" && claudeMode !== "dontAsk";
}

export function deriveUiModeForMode(backend: "claude" | "codex", permissionMode: string): "plan" | "agent" {
  if (backend === "codex") return "agent";
  return normalizeClaudePermissionMode(permissionMode) === "plan" ? "plan" : "agent";
}
