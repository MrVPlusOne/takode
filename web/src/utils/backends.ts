import type { BackendModelInfo } from "../api.js";
import { getBackendFamily, getDefaultModelForBackend, type BackendSelection } from "../../shared/backend-defaults.js";
import {
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
  contextWindow?: number;
  maxContextWindow?: number;
  effectiveContextWindowPercent?: number;
  autoCompactTokenLimit?: number | null;
  serviceTiers?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  supportedReasoningLevels?: Array<{
    effort: string;
    description?: string;
  }>;
  defaultReasoningLevel?: string;
}

export interface ModeOption {
  value: string;
  label: string;
  description?: string;
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
    contextWindow: m.contextWindow,
    maxContextWindow: m.maxContextWindow,
    effectiveContextWindowPercent: m.effectiveContextWindowPercent,
    autoCompactTokenLimit: m.autoCompactTokenLimit,
    serviceTiers: m.serviceTiers,
    supportedReasoningLevels: m.supportedReasoningLevels,
    defaultReasoningLevel: m.defaultReasoningLevel,
  }));
}

// ─── Static fallbacks ────────────────────────────────────────────────────────

// Used only until a Claude session reports the CLI's own catalog. Claude Code
// resolves these aliases to its current models, including any user overrides,
// so the fallback never pins a model version that goes stale.
export const CLAUDE_MODELS: ModelOption[] = [
  { value: "", label: "Default", icon: "\u25C6" },
  { value: "opus", label: "Opus", icon: "\u2733" },
  { value: "sonnet", label: "Sonnet", icon: "\u25D5" },
  { value: "haiku", label: "Haiku", icon: "\u26A1" },
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
  { value: "auto", label: "Auto" },
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
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

function labelForReasoningEffort(effort: string): string {
  const known = CODEX_REASONING_EFFORTS.find((option) => option.value === effort);
  if (known) return known.label;
  return effort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 4 ? part[0]?.toUpperCase() + part.slice(1) : part[0]?.toUpperCase() + part.slice(1)))
    .join(" ");
}

export function getCodexReasoningEffortOptions(options?: {
  modelOptions?: ModelOption[];
  model?: string;
  currentEffort?: string | null;
  includeDefault?: boolean;
}): ModeOption[] {
  const includeDefault = options?.includeDefault !== false;
  const selectedModel = options?.modelOptions?.find((model) => model.value === options.model);
  const catalogLevels = selectedModel?.supportedReasoningLevels;
  const base =
    catalogLevels && catalogLevels.length > 0
      ? catalogLevels.map((level) => ({
          value: level.effort,
          label: labelForReasoningEffort(level.effort),
          description: level.description,
        }))
      : CODEX_REASONING_EFFORTS.filter((option) => option.value);
  const next = includeDefault ? [CODEX_REASONING_EFFORTS[0], ...base] : [...base];
  const currentEffort = options?.currentEffort?.trim().toLowerCase();
  if (currentEffort && !next.some((option) => option.value === currentEffort)) {
    next.push({ value: currentEffort, label: labelForReasoningEffort(currentEffort) });
  }
  const seen = new Set<string>();
  return next.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

/** Claude permission modes offered in permission menus, in menu order. */
export const CLAUDE_PERMISSION_MODES: ClaudePermissionOption[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Claude's classifier approves safe actions; others come to Takode for approval.",
  },
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
    value: "plan",
    label: "Plan",
    description: "Start in planning mode before executing changes.",
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Auto-approve all tools locally.",
  },
];

// Modes no longer offered but still accepted for sessions and defaults saved with them.
const CLAUDE_RETIRED_PERMISSION_MODES: ClaudePermissionOption[] = [
  {
    value: "delegate",
    label: "Delegate",
    description: "No longer offered. Choose another mode to switch.",
  },
  {
    value: "dontAsk",
    label: "Don't ask",
    description: "No longer offered. Choose another mode to switch.",
  },
];

/**
 * Claude permission menu options for a control currently set to `currentMode`.
 * A retired mode is listed only while it is the current value, so its label
 * stays visible until the user picks one of the offered modes.
 */
export function getClaudePermissionMenuOptions(currentMode?: string | null): ClaudePermissionOption[] {
  const retired = CLAUDE_RETIRED_PERMISSION_MODES.find((option) => option.value === currentMode);
  return retired ? [...CLAUDE_PERMISSION_MODES, retired] : CLAUDE_PERMISSION_MODES;
}

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

export function getModelsForBackend(backend: BackendSelection): ModelOption[] {
  return getBackendFamily(backend) === "codex" ? CODEX_MODELS : CLAUDE_MODELS;
}

export function getModesForBackend(backend: BackendSelection): ModeOption[] {
  return getBackendFamily(backend) === "codex" ? CODEX_MODES : CLAUDE_MODES;
}

export function getDefaultModel(backend: BackendSelection): string {
  return getDefaultModelForBackend(backend);
}

export function getDefaultMode(backend: BackendSelection): string {
  return getModesForBackend(backend)[0].value;
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

export function deriveAskPermissionForMode(backend: "claude" | "codex", permissionMode: string): boolean {
  return deriveSharedAskPermissionForMode(backend, permissionMode);
}
