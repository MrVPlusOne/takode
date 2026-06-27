export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const CLAUDE_REASONING_EFFORTS = ["low", "medium", "high", "max"] as const;
export const CLAUDE_1M_CONTEXT_TOKENS = 1_000_000;
export const CLAUDE_1M_CONTEXT_BETA = "context-1m-2025-08-07";

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_EFFORTS)[number];

export interface CodexSessionDefaults {
  model: string;
  serviceTier: string | null;
  reasoningEffort: CodexReasoningEffort | "";
  internetAccess: boolean;
  maxContextLength: number | null;
}

export interface ClaudeSessionDefaults {
  model: string;
  permissionMode: string;
  reasoningEffort: ClaudeReasoningEffort | "";
  maxContextLength: number | null;
}

export interface SessionDefaultsSettings {
  codex: CodexSessionDefaults;
  claude: ClaudeSessionDefaults;
}

export const DEFAULT_SESSION_DEFAULTS: SessionDefaultsSettings = {
  codex: {
    model: "",
    serviceTier: null,
    reasoningEffort: "",
    internetAccess: false,
    maxContextLength: null,
  },
  claude: {
    model: "",
    permissionMode: "",
    reasoningEffort: "",
    maxContextLength: null,
  },
};

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return numeric;
}

function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | "" {
  const normalized = stringOrEmpty(value).toLowerCase();
  return CODEX_REASONING_EFFORTS.includes(normalized as CodexReasoningEffort)
    ? (normalized as CodexReasoningEffort)
    : "";
}

function normalizeClaudeReasoningEffort(value: unknown): ClaudeReasoningEffort | "" {
  const normalized = stringOrEmpty(value).toLowerCase();
  return CLAUDE_REASONING_EFFORTS.includes(normalized as ClaudeReasoningEffort)
    ? (normalized as ClaudeReasoningEffort)
    : "";
}

export function normalizeSessionDefaults(value: unknown): SessionDefaultsSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const codex = raw.codex && typeof raw.codex === "object" ? (raw.codex as Record<string, unknown>) : {};
  const claude = raw.claude && typeof raw.claude === "object" ? (raw.claude as Record<string, unknown>) : {};
  const codexServiceTier = stringOrEmpty(codex.serviceTier);
  const claudePermissionMode = stringOrEmpty(claude.permissionMode);

  return {
    codex: {
      model: stringOrEmpty(codex.model),
      serviceTier: codexServiceTier || null,
      reasoningEffort: normalizeCodexReasoningEffort(codex.reasoningEffort),
      internetAccess: typeof codex.internetAccess === "boolean" ? codex.internetAccess : false,
      maxContextLength: normalizePositiveIntegerOrNull(codex.maxContextLength),
    },
    claude: {
      model: stringOrEmpty(claude.model),
      permissionMode: claudePermissionMode,
      reasoningEffort: normalizeClaudeReasoningEffort(claude.reasoningEffort),
      maxContextLength: normalizePositiveIntegerOrNull(claude.maxContextLength),
    },
  };
}

export function isSupportedClaudeDefaultMaxContext(value: number | null): boolean {
  return value === null || value === CLAUDE_1M_CONTEXT_TOKENS;
}
