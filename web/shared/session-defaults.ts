export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const CLAUDE_REASONING_EFFORTS = ["low", "medium", "high", "max"] as const;
export const CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
export const CODEX_LEADER_RECYCLE_BUFFER_TOKENS = 25_000;
export const CLAUDE_1M_CONTEXT_TOKENS = 1_000_000;
export const CLAUDE_1M_CONTEXT_BETA = "context-1m-2025-08-07";
export const SESSION_DEFAULTS_UPDATED_EVENT = "takode:session-defaults-updated";

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_EFFORTS)[number];

export interface CodexSessionLaunchDefaults {
  model: string;
  serviceTier: string | null;
  reasoningEffort: CodexReasoningEffort | string;
  internetAccess: boolean;
  maxContextLength: number | null;
}

/** Worker-compatible Codex defaults also carry the single global preview estimate. */
export interface CodexSessionDefaults extends CodexSessionLaunchDefaults {
  effectiveContextWindowPercent: number;
}

export interface ClaudeSessionDefaults {
  model: string;
  permissionMode: string;
  reasoningEffort: ClaudeReasoningEffort | "";
  maxContextLength: number | null;
}

export interface SessionRoleDefaults {
  codex: CodexSessionLaunchDefaults;
  claude: ClaudeSessionDefaults;
}

/**
 * The top-level codex/claude fields remain the worker defaults for compatibility
 * with older Takode builds. Leader defaults deliberately omit the global Codex
 * context-estimate percentage so display policy is not duplicated per role.
 */
export interface SessionDefaultsSettings {
  codex: CodexSessionDefaults;
  claude: ClaudeSessionDefaults;
  leader: SessionRoleDefaults;
  leaderUsesWorkerDefaults: boolean;
}

const DEFAULT_CODEX_LAUNCH_DEFAULTS: CodexSessionLaunchDefaults = {
  model: "",
  serviceTier: null,
  reasoningEffort: "",
  internetAccess: false,
  maxContextLength: null,
};

export const DEFAULT_SESSION_ROLE_DEFAULTS: SessionRoleDefaults = {
  codex: { ...DEFAULT_CODEX_LAUNCH_DEFAULTS },
  claude: {
    model: "",
    permissionMode: "",
    reasoningEffort: "",
    maxContextLength: null,
  },
};

export const DEFAULT_SESSION_DEFAULTS: SessionDefaultsSettings = {
  codex: {
    ...DEFAULT_CODEX_LAUNCH_DEFAULTS,
    effectiveContextWindowPercent: CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
  },
  claude: { ...DEFAULT_SESSION_ROLE_DEFAULTS.claude },
  leader: {
    codex: { ...DEFAULT_SESSION_ROLE_DEFAULTS.codex },
    claude: { ...DEFAULT_SESSION_ROLE_DEFAULTS.claude },
  },
  leaderUsesWorkerDefaults: true,
};

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSafeCodexReasoningEffort(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

function normalizePositiveIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return numeric;
}

function normalizePercent(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= 100 ? numeric : fallback;
}

function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | string {
  const normalized = stringOrEmpty(value).toLowerCase();
  return normalized && isSafeCodexReasoningEffort(normalized) ? normalized : "";
}

function normalizeClaudeReasoningEffort(value: unknown): ClaudeReasoningEffort | "" {
  const normalized = stringOrEmpty(value).toLowerCase();
  return CLAUDE_REASONING_EFFORTS.includes(normalized as ClaudeReasoningEffort)
    ? (normalized as ClaudeReasoningEffort)
    : "";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeRoleDefaults(value: unknown, fallback: SessionRoleDefaults): SessionRoleDefaults {
  const raw = objectRecord(value);
  const codex = objectRecord(raw.codex);
  const claude = objectRecord(raw.claude);
  const codexServiceTier = stringOrEmpty(
    codex.serviceTier === undefined ? fallback.codex.serviceTier : codex.serviceTier,
  );
  const claudePermissionMode = stringOrEmpty(claude.permissionMode ?? fallback.claude.permissionMode);

  return {
    codex: {
      model: stringOrEmpty(codex.model ?? fallback.codex.model),
      serviceTier: codexServiceTier || null,
      reasoningEffort: normalizeCodexReasoningEffort(codex.reasoningEffort ?? fallback.codex.reasoningEffort),
      internetAccess: typeof codex.internetAccess === "boolean" ? codex.internetAccess : fallback.codex.internetAccess,
      maxContextLength:
        codex.maxContextLength === undefined
          ? fallback.codex.maxContextLength
          : normalizePositiveIntegerOrNull(codex.maxContextLength),
    },
    claude: {
      model: stringOrEmpty(claude.model ?? fallback.claude.model),
      permissionMode: claudePermissionMode,
      reasoningEffort: normalizeClaudeReasoningEffort(claude.reasoningEffort ?? fallback.claude.reasoningEffort),
      maxContextLength:
        claude.maxContextLength === undefined
          ? fallback.claude.maxContextLength
          : normalizePositiveIntegerOrNull(claude.maxContextLength),
    },
  };
}

export function workerSessionRoleDefaults(settings: SessionDefaultsSettings): SessionRoleDefaults {
  return {
    codex: {
      model: settings.codex.model,
      serviceTier: settings.codex.serviceTier,
      reasoningEffort: settings.codex.reasoningEffort,
      internetAccess: settings.codex.internetAccess,
      maxContextLength: settings.codex.maxContextLength,
    },
    claude: { ...settings.claude },
  };
}

export function resolveSessionDefaultsForRole(value: unknown, role: "worker" | "leader"): SessionRoleDefaults {
  const normalized = normalizeSessionDefaults(value);
  if (role === "leader" && !normalized.leaderUsesWorkerDefaults) return normalized.leader;
  return workerSessionRoleDefaults(normalized);
}

export function normalizeSessionDefaults(value: unknown): SessionDefaultsSettings {
  const raw = objectRecord(value);
  const legacyWorkerSource = raw.worker && typeof raw.worker === "object" ? raw.worker : raw;
  const worker = normalizeRoleDefaults(legacyWorkerSource, DEFAULT_SESSION_ROLE_DEFAULTS);
  const workerCodex = objectRecord(objectRecord(legacyWorkerSource).codex);
  const effectiveContextWindowPercent = normalizePercent(
    raw.codexEffectiveContextWindowPercent ?? workerCodex.effectiveContextWindowPercent,
    CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
  );
  const leader = normalizeRoleDefaults(raw.leader, worker);

  return {
    codex: { ...worker.codex, effectiveContextWindowPercent },
    claude: worker.claude,
    leader,
    leaderUsesWorkerDefaults: typeof raw.leaderUsesWorkerDefaults === "boolean" ? raw.leaderUsesWorkerDefaults : true,
  };
}

export function isSupportedClaudeDefaultMaxContext(value: number | null): boolean {
  return value === null || value === CLAUDE_1M_CONTEXT_TOKENS;
}
