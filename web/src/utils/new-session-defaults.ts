import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";
import {
  deriveCodexAskPermission,
  deriveAskPermissionForMode,
  getDefaultMode,
  getDefaultModel,
  getModelsForBackend,
  getModesForBackend,
  normalizeClaudePermission,
  normalizeCodexPermissionMode,
  type CodexPermissionMode,
} from "./backends.js";

export type NewSessionBackend = "claude" | "codex";

const VALID_BACKENDS = new Set<NewSessionBackend>(["claude", "codex"]);

export interface NewSessionDefaults {
  backend: NewSessionBackend;
  model: string;
  mode: string;
  askPermission: boolean;
  sessionRole: "worker" | "leader";
  envSlug: string;
  cwd: string;
  useWorktree: boolean;
  codexInternetAccess: boolean;
  codexReasoningEffort: string;
  codexPermissionMode: CodexPermissionMode;
}

export interface LastSessionCreationContext {
  cwd: string;
  treeGroupId?: string;
  newSessionDefaultsKey?: string;
}

type NewSessionDefaultsCandidate = Partial<Omit<NewSessionDefaults, "codexPermissionMode">> & {
  codexPermissionMode?: string | null;
};
type StoredGroupDefaults = NewSessionDefaultsCandidate & { updatedAt?: number };

const GROUP_DEFAULTS_KEY = "cc-new-session-groups";
const LAST_SESSION_CREATION_CONTEXT_KEY = "cc-last-session-creation-context";
const MAX_GROUP_DEFAULTS = 50;
const TREE_GROUP_DEFAULTS_PREFIX = "tree-group:";

function normalizeAskPermission(raw: boolean | null | undefined): boolean {
  return raw ?? true;
}

function normalizeMode(
  backend: NewSessionBackend,
  rawMode: string | null | undefined,
  rawAskPermission: boolean | null | undefined,
): { mode: string; askPermission: boolean } {
  if (backend === "codex") {
    const askPermission =
      rawMode === "suggest" || rawMode === "bypassPermissions"
        ? deriveCodexAskPermission(rawMode)
        : normalizeAskPermission(rawAskPermission);
    return {
      mode: getDefaultMode(backend),
      askPermission,
    };
  }

  if (rawMode === "agent") {
    const askPermission = normalizeAskPermission(rawAskPermission);
    return {
      mode: askPermission ? "acceptEdits" : "bypassPermissions",
      askPermission,
    };
  }

  const modes = getModesForBackend(backend);
  const mode =
    rawMode && modes.some((entry) => entry.value === rawMode)
      ? normalizeClaudePermission(rawMode)
      : getDefaultMode(backend);
  return {
    mode,
    askPermission: deriveAskPermissionForMode("claude", mode),
  };
}

function normalizeModel(backend: NewSessionBackend, rawModel: string | null | undefined): string {
  if (backend === "codex") {
    return rawModel ?? "";
  }

  const models = getModelsForBackend(backend);
  return rawModel !== null && rawModel !== undefined && models.some((entry) => entry.value === rawModel)
    ? rawModel
    : getDefaultModel(backend);
}

function normalizeStoredCodexPermissionMode(
  rawPermissionMode: string | null | undefined,
  rawMode: string | null | undefined,
  askPermission: boolean,
): CodexPermissionMode {
  const normalized = normalizeCodexPermissionMode(rawPermissionMode);
  if (rawPermissionMode && normalized !== "default") return normalized;
  if (rawPermissionMode === "default") return "default";
  if (rawMode === "suggest" || rawMode === "acceptEdits" || rawMode === "plan") return "default";
  if (rawMode === "bypassPermissions" || askPermission === false) return "full-access";
  return "default";
}

function parseGroupDefaultsMap(): Record<string, StoredGroupDefaults> {
  try {
    const raw = scopedGetItem(GROUP_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, StoredGroupDefaults>;
  } catch {
    return {};
  }
}

function buildDefaults(candidate: NewSessionDefaultsCandidate): NewSessionDefaults {
  const backend = candidate.backend && VALID_BACKENDS.has(candidate.backend) ? candidate.backend : "claude";
  const { mode, askPermission } = normalizeMode(backend, candidate.mode, candidate.askPermission);
  const codexPermissionMode =
    backend === "codex"
      ? normalizeStoredCodexPermissionMode(candidate.codexPermissionMode, candidate.mode, askPermission)
      : normalizeCodexPermissionMode(candidate.codexPermissionMode);
  return {
    backend,
    model: normalizeModel(backend, candidate.model),
    mode,
    askPermission,
    sessionRole: "worker",
    envSlug: candidate.envSlug ?? "",
    cwd: candidate.cwd?.trim() ?? "",
    useWorktree: candidate.useWorktree ?? true,
    codexInternetAccess: candidate.codexInternetAccess ?? false,
    codexReasoningEffort: candidate.codexReasoningEffort ?? "",
    codexPermissionMode,
  };
}

function normalizeLastSessionCreationContext(
  candidate: Partial<LastSessionCreationContext> | null | undefined,
): LastSessionCreationContext | null {
  if (!candidate) return null;
  const cwd = candidate.cwd?.trim() ?? "";
  if (!cwd) return null;
  return {
    cwd,
    treeGroupId: candidate.treeGroupId?.trim() || undefined,
    newSessionDefaultsKey: candidate.newSessionDefaultsKey?.trim() || undefined,
  };
}

export function getGlobalNewSessionDefaults(): NewSessionDefaults {
  const raw = scopedGetItem("cc-backend");
  const backend = raw && VALID_BACKENDS.has(raw as NewSessionBackend) ? (raw as NewSessionBackend) : "claude";
  const askPermissionRaw = (() => {
    const stored = scopedGetItem("cc-ask-permission");
    return stored !== null ? stored === "true" : null;
  })();

  return buildDefaults({
    backend,
    model: scopedGetItem(`cc-model-${backend}`) ?? undefined,
    mode: scopedGetItem("cc-mode") ?? undefined,
    askPermission: askPermissionRaw ?? undefined,
    sessionRole: "worker",
    envSlug: scopedGetItem("cc-selected-env") || "",
    useWorktree: (() => {
      const stored = scopedGetItem("cc-worktree");
      return stored === null ? true : stored === "true";
    })(),
    codexInternetAccess: scopedGetItem("cc-codex-internet-access") === "1",
    codexReasoningEffort: scopedGetItem("cc-codex-reasoning-effort") ?? "",
    codexPermissionMode: scopedGetItem("cc-codex-permission-mode") ?? undefined,
  });
}

export function getTreeGroupNewSessionDefaultsKey(treeGroupId: string): string {
  const key = treeGroupId.trim();
  return key ? `${TREE_GROUP_DEFAULTS_PREFIX}${key}` : "";
}

export function getGroupNewSessionDefaults(groupKey: string): NewSessionDefaults {
  const globalDefaults = getGlobalNewSessionDefaults();
  const key = groupKey.trim();
  if (!key) return globalDefaults;

  const stored = parseGroupDefaultsMap()[key];
  if (!stored) return globalDefaults;
  return buildDefaults({ ...globalDefaults, ...stored });
}

export function getCachedGroupNewSessionDefaults(groupKey: string): NewSessionDefaults | null {
  const key = groupKey.trim();
  if (!key) return null;

  const stored = parseGroupDefaultsMap()[key];
  if (!stored) return null;
  return buildDefaults({ ...getGlobalNewSessionDefaults(), ...stored });
}

export function saveGroupNewSessionDefaults(groupKey: string, defaults: NewSessionDefaults): void {
  const key = groupKey.trim();
  if (!key) return;

  const next = parseGroupDefaultsMap();
  next[key] = {
    ...buildDefaults(defaults),
    updatedAt: Date.now(),
  };

  const entries = Object.entries(next);
  if (entries.length > MAX_GROUP_DEFAULTS) {
    entries
      .sort((a, b) => (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0))
      .slice(0, entries.length - MAX_GROUP_DEFAULTS)
      .forEach(([staleKey]) => {
        delete next[staleKey];
      });
  }

  scopedSetItem(GROUP_DEFAULTS_KEY, JSON.stringify(next));
}

export function getLastSessionCreationContext(): LastSessionCreationContext | null {
  try {
    const raw = scopedGetItem(LAST_SESSION_CREATION_CONTEXT_KEY);
    if (!raw) return null;
    return normalizeLastSessionCreationContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveLastSessionCreationContext(context: LastSessionCreationContext): void {
  const normalized = normalizeLastSessionCreationContext(context);
  if (!normalized) return;
  scopedSetItem(LAST_SESSION_CREATION_CONTEXT_KEY, JSON.stringify(normalized));
}
