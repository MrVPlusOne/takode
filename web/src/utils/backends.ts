import type { BackendType } from "../types.js";
import { assertNever } from "../types.js";
import type { BackendModelInfo } from "../api.js";
import { getDefaultModelForBackend } from "../../shared/backend-defaults.js";
import {
  CLAUDE_PERMISSION_MODES as CLAUDE_PERMISSION_MODE_VALUES,
  deriveAskPermissionForMode as deriveSharedAskPermissionForMode,
  deriveCodexPermissionMode as deriveSharedCodexPermissionMode,
  deriveUiModeForMode,
  normalizeClaudePermissionMode,
  normalizeCodexPermissionProfile,
  resolveCodexPermissionProfile,
  type ClaudePermissionMode,
  type CodexPermissionMode,
} from "../../shared/permission-modes.js";

export interface ModelOption {
  value: string;
  label: string;
  icon: string;
}

export interface ModeOption {
  value: string;
  label: string;
}

export interface PermissionOption<T extends string = string> {
  value: T;
  label: string;
  description: string;
}

export type { ClaudePermissionMode, CodexPermissionMode };
export type CodexPermissionOption = PermissionOption<CodexPermissionMode>;
export type ClaudePermissionOption = PermissionOption<ClaudePermissionMode>;

// ─── Icon assignment for dynamically fetched models ──────────────────────────

const MODEL_ICONS: Record<string, string> = {
  codex: "\u2733", // ✳ for codex-optimized models
  max: "\u25A0", // ■ for max/flagship
  mini: "\u26A1", // ⚡ for mini/fast
};

function pickIcon(slug: string, index: number): string {
  for (const [key, icon] of Object.entries(MODEL_ICONS)) {
    if (slug.includes(key)) return icon;
  }
  const fallback = ["\u25C6", "\u25CF", "\u25D5", "\u2726"]; // ◆ ● ◕ ✦
  return fallback[index % fallback.length];
}

/** Convert server model info to frontend ModelOption with icons. */
export function toModelOptions(models: BackendModelInfo[]): ModelOption[] {
  return models.map((m, i) => ({
    value: m.value,
    label: m.label || m.value,
    icon: pickIcon(m.value, i),
  }));
}

// ─── Static fallbacks ────────────────────────────────────────────────────────

export const CLAUDE_MODELS: ModelOption[] = [
  { value: "", label: "Default", icon: "\u25C6" },
  { value: "claude-opus-4-6[1m]", label: "Opus 4.6 [1M]", icon: "\u2733" },
  { value: "claude-opus-4-6", label: "Opus 4.6 [200K]", icon: "\u2733" },
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5 [200K]", icon: "\u25D5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 [200K]", icon: "\u26A1" },
];

export const CODEX_MODELS: ModelOption[] = [
  { value: "", label: "Default", icon: "\u25C6" },
  { value: "gpt-5.4", label: "GPT-5.4", icon: "\u2733" },
];

export const CLAUDE_MODES: ModeOption[] = [
  { value: "acceptEdits", label: "Accept edits" },
  { value: "bypassPermissions", label: "Full access" },
  { value: "plan", label: "Plan" },
  { value: "default", label: "Default" },
  { value: "delegate", label: "Delegate" },
  { value: "dontAsk", label: "Don't ask" },
];

export const CODEX_MODES: ModeOption[] = [
  { value: "default", label: "Default" },
  { value: "auto-review", label: "Auto-review" },
  { value: "full-access", label: "Full access" },
  { value: "custom", label: "Custom" },
];

export const CODEX_REASONING_EFFORTS: ModeOption[] = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
];

export const CLAUDE_PERMISSION_MODES: ClaudePermissionOption[] = [
  {
    value: "default",
    label: "Default",
    description: "Use Claude Code's default permission behavior.",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    description: "Auto-approve file edits; ask before other tools.",
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Auto-approve all tools locally.",
  },
  {
    value: "plan",
    label: "Plan",
    description: "Start in planning mode before executing changes.",
  },
  {
    value: "delegate",
    label: "Delegate",
    description: "Use Claude Code's delegate permission mode.",
  },
  {
    value: "dontAsk",
    label: "Don't ask",
    description: "Use Claude Code's non-prompting permission mode.",
  },
];

export const CODEX_PERMISSION_MODES: CodexPermissionOption[] = [
  {
    value: "default",
    label: "Default",
    description: "Sandboxed workspace access; Codex can ask for elevated actions.",
  },
  {
    value: "auto-review",
    label: "Auto-review",
    description: "Workspace sandbox with Codex Auto Review; use narrow rules and writable roots for managed access.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "No sandbox and no prompts. Only use when your machine supports it.",
  },
  {
    value: "custom",
    label: "Custom (config.toml)",
    description: "Use approval_policy and sandbox_mode from Codex config.toml.",
  },
];

// ─── Getters ─────────────────────────────────────────────────────────────────

export function getModelsForBackend(backend: BackendType): ModelOption[] {
  switch (backend) {
    case "claude":
    case "claude-sdk":
      return CLAUDE_MODELS;
    case "codex":
      return CODEX_MODELS;
    default:
      return assertNever(backend);
  }
}

export function getModesForBackend(backend: BackendType): ModeOption[] {
  switch (backend) {
    case "claude":
    case "claude-sdk":
      return CLAUDE_MODES;
    case "codex":
      return CODEX_MODES;
    default:
      return assertNever(backend);
  }
}

export function getDefaultModel(backend: BackendType): string {
  return getDefaultModelForBackend(backend);
}

export function getDefaultMode(backend: BackendType): string {
  switch (backend) {
    case "claude":
    case "claude-sdk":
      return CLAUDE_MODES[0].value;
    case "codex":
      return CODEX_MODES[0].value;
    default:
      return assertNever(backend);
  }
}

/** Cycle to the next mode; falls back to first mode if currentMode is unknown. */
export function getNextMode(currentMode: string, modes: ModeOption[]): string {
  const idx = modes.findIndex((m) => m.value === currentMode);
  return modes[(idx + 1) % modes.length].value;
}

/**
 * Format model ID for concise display in the composer button.
 *
 * Strips `claude-` prefix and trailing date suffix, joins version
 * numbers with dots, and preserves bracket suffixes like `[1m]`.
 *
 *   "claude-opus-4-6-20250514"     → "opus-4.6"
 *   "claude-opus-4-6[1m]"          → "opus-4.6[1m]"
 *   "claude-sonnet-4-5-20250929"   → "sonnet-4.5"
 *   "gpt-5.4"                      → "gpt-5.4"
 */
export function formatModel(model: string): string {
  // Extract bracket suffix (e.g. "[1m]") before processing
  let bracket = "";
  const bracketMatch = model.match(/(\[.+\])$/);
  if (bracketMatch) {
    bracket = bracketMatch[1];
    model = model.slice(0, -bracket.length);
  }
  // Strip trailing date suffix and claude- prefix
  model = model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
  // Join consecutive numeric dash-segments with dots: "opus-4-6" → "opus-4.6"
  const parts = model.split("-");
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i]) && result.length > 0 && /\d+$/.test(result[result.length - 1])) {
      result[result.length - 1] += "." + parts[i];
    } else {
      result.push(parts[i]);
    }
  }
  return result.join("-") + bracket;
}

// ─── Permission mode compatibility helpers ────────────────────────────────────
//
// The current UI exposes backend-native permission modes directly. These helpers
// remain for stored defaults, protocol compatibility, and existing tests that
// still exercise the historical Plan/Agent + Ask mapping.

/**
 * Maps the UI mode ("plan" or "agent") + askPermission toggle to the actual
 * Claude Code CLI permission mode string.
 *
 * | UI Mode | Ask Permission | CLI Mode          |
 * |---------|---------------|-------------------|
 * | plan    | true/false    | "plan"            |
 * | agent   | true          | "acceptEdits"     |
 * | agent   | false         | "bypassPermissions"|
 */
export function resolveClaudeCliMode(uiMode: string, askPermission: boolean): string {
  if (uiMode === "plan") return "plan";
  // agent mode
  return askPermission ? "acceptEdits" : "bypassPermissions";
}

export function normalizeClaudePermission(raw: string | null | undefined): ClaudePermissionMode {
  return normalizeClaudePermissionMode(raw);
}

export function resolveClaudePermissionCliMode(permissionMode: ClaudePermissionMode): string {
  return permissionMode;
}

/**
 * After a plan is approved (ExitPlanMode), determine the CLI mode to switch to.
 *
 * | Ask Permission | Post-Plan CLI Mode   |
 * |---------------|---------------------|
 * | true          | "acceptEdits"       |
 * | false         | "bypassPermissions" |
 */
export function resolvePostPlanMode(askPermission: boolean): string {
  return askPermission ? "acceptEdits" : "bypassPermissions";
}

/**
 * Derive the UI mode from a raw CLI permission mode string.
 * Used to translate server-reported permissionMode back to the UI concept.
 */
export function deriveUiMode(cliMode: string): "plan" | "agent" {
  return deriveUiModeForMode("claude", cliMode);
}

// ─── Codex legacy mode mapping ─────────────────────────────────────────────────

/**
 * Maps the shared UI mode ("plan" or "agent") + askPermission toggle to the
 * raw Codex mode string consumed by the server/launcher.
 *
 * | UI Mode | Ask Permission | Codex Mode          |
 * |---------|----------------|---------------------|
 * | plan    | true           | "plan"              |
 * | plan    | false          | "plan"              |
 * | agent   | true           | "suggest"           |
 * | agent   | false          | "bypassPermissions" |
 */
export function resolveCodexCliMode(uiMode: string, askPermission: boolean): string {
  if (uiMode === "plan") return "plan";
  return askPermission ? "suggest" : "bypassPermissions";
}

export function normalizeCodexPermissionMode(raw: string | null | undefined): CodexPermissionMode {
  return CODEX_PERMISSION_MODES.some((option) => option.value === raw) ? (raw as CodexPermissionMode) : "default";
}

export function resolveCodexPermissionCliMode(permissionMode: CodexPermissionMode): string {
  return resolveCodexPermissionProfile(permissionMode);
}

export function deriveCodexPermissionMode(cliMode: string | null | undefined): CodexPermissionMode {
  return deriveSharedCodexPermissionMode(cliMode);
}

/** Derive the shared UI mode from a raw Codex mode string. */
export function deriveCodexUiMode(cliMode: string): "plan" | "agent" {
  return deriveUiModeForMode("codex", cliMode);
}

/** Derive askPermission state from a raw Codex mode string. */
export function deriveCodexAskPermission(cliMode: string): boolean {
  return deriveSharedAskPermissionForMode("codex", normalizeCodexPermissionProfile(cliMode));
}

export function getClaudePermissionOptions(): ClaudePermissionOption[] {
  return CLAUDE_PERMISSION_MODES.filter((option) => CLAUDE_PERMISSION_MODE_VALUES.includes(option.value));
}

export function deriveAskPermissionForMode(backend: "claude" | "codex", permissionMode: string): boolean {
  return deriveSharedAskPermissionForMode(backend, permissionMode);
}
