import type { Hono } from "hono";
import {
  CLAUDE_1M_CONTEXT_TOKENS,
  CLAUDE_REASONING_EFFORTS,
  isSafeCodexReasoningEffort,
} from "../../shared/session-defaults.js";
import {
  deriveAskPermissionForMode,
  deriveUiModeForMode,
  isClaudePermissionMode,
  normalizeCodexPermissionProfile,
} from "../../shared/permission-modes.js";
import type { RouteContext } from "./context.js";
import { resolveCodexSandboxForPermissionMode } from "./session-permission-mode.js";
import { markCodexModelSwitchCompactionGuard } from "../bridge/codex-model-switch-compaction.js";

type ConfigField =
  | "model"
  | "permissionMode"
  | "codexInternetAccess"
  | "codexReasoningEffort"
  | "codexServiceTier"
  | "codexMaxContextLength"
  | "claudeReasoningEffort"
  | "claudeMaxContextLength";

type StatePatch = Record<string, string | number | boolean | null>;

const CODEX_RESTART_FIELDS = new Set<ConfigField>([
  "model",
  "permissionMode",
  "codexInternetAccess",
  "codexReasoningEffort",
  "codexMaxContextLength",
]);
const CLAUDE_RESTART_FIELDS = new Set<ConfigField>(["claudeReasoningEffort", "claudeMaxContextLength"]);

function hasOwn(body: Record<string, unknown>, key: ConfigField): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseNullableString(body: Record<string, unknown>, key: ConfigField): string | null | undefined {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : "";
}

function parseNullablePositiveInteger(
  body: Record<string, unknown>,
  key: ConfigField,
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  if (!hasOwn(body, key)) return { ok: true, value: undefined };
  const value = body[key];
  if (value === null || value === "") return { ok: true, value: null };
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    return { ok: false, error: `${key} must be a positive integer or null` };
  }
  return { ok: true, value: numeric };
}

function normalizeNullableEffort<T extends readonly string[]>(
  value: string | null | undefined,
  valid: T,
  key: ConfigField,
): { ok: true; value: T[number] | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: undefined };
  const normalized = value.toLowerCase();
  if (!valid.includes(normalized)) return { ok: false, error: `${key} is not supported: ${value}` };
  return { ok: true, value: normalized };
}

function normalizeNullableCodexEffort(
  value: string | null | undefined,
  key: ConfigField,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: undefined };
  const normalized = value.toLowerCase();
  if (!isSafeCodexReasoningEffort(normalized)) return { ok: false, error: `${key} is not supported: ${value}` };
  return { ok: true, value: normalized };
}

function changed<T>(current: T | undefined | null, next: T | undefined | null): boolean {
  return (current ?? null) !== (next ?? null);
}

function liveStateValue<T>(
  state: Record<string, unknown> | undefined,
  key: string,
  fallback: T | null | undefined,
): T | null | undefined {
  if (state && Object.prototype.hasOwnProperty.call(state, key)) {
    return state[key] as T | null | undefined;
  }
  return fallback;
}

function buildSessionConfigResponse(session: NonNullable<ReturnType<RouteContext["launcher"]["getSession"]>>) {
  return {
    model: session.model,
    permissionMode: session.permissionMode,
    askPermission: session.askPermission,
    uiMode: session.uiMode,
    codexInternetAccess: session.codexInternetAccess ?? null,
    codexReasoningEffort: session.codexReasoningEffort ?? null,
    codexServiceTier: session.codexServiceTier ?? null,
    codexMaxContextLength: session.codexMaxContextLength ?? null,
    claudeReasoningEffort: session.claudeReasoningEffort ?? null,
    claudeMaxContextLength: session.claudeMaxContextLength ?? null,
  };
}

export function registerSessionConfigRoutes(api: Hono, ctx: Pick<RouteContext, "launcher" | "resolveId" | "wsBridge">) {
  const { launcher, resolveId, wsBridge } = ctx;

  api.put("/sessions/:id/config", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);

    const backendType = info.backendType || "claude";
    if (backendType !== "codex" && backendType !== "claude" && backendType !== "claude-sdk") {
      return c.json({ error: `Unsupported backend for session configuration: ${backendType}` }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const session = wsBridge.getOrCreateSession(id, backendType);
    const liveState = session.state as unknown as Record<string, unknown>;
    const backendConnected = wsBridge.isBackendConnected(id);
    const restartFields = backendType === "codex" ? CODEX_RESTART_FIELDS : CLAUDE_RESTART_FIELDS;
    const changedFields: ConfigField[] = [];
    const immediateFields: ConfigField[] = [];
    const restartRequiredFields: ConfigField[] = [];
    const statePatch: StatePatch = {};
    const launchPatch: Parameters<typeof launcher.updateSessionLaunchConfig>[1] = {};

    function record(field: ConfigField, stateKey: string, value: string | number | boolean | null | undefined): void {
      changedFields.push(field);
      if (restartFields.has(field)) restartRequiredFields.push(field);
      else immediateFields.push(field);
      statePatch[stateKey] = value ?? null;
    }

    const rawModel = parseNullableString(body, "model");
    if (rawModel !== undefined) {
      if (!rawModel) return c.json({ error: "model must be a non-empty string" }, 400);
      const current = liveStateValue<string>(liveState, "model", info.model) || "";
      if (changed(current, rawModel)) {
        launchPatch.model = rawModel;
        if (backendType === "codex") {
          markCodexModelSwitchCompactionGuard(session, { previousModel: current, nextModel: rawModel });
        }
        record("model", "model", rawModel);
      }
    }

    const rawMode = parseNullableString(body, "permissionMode");
    if (rawMode !== undefined) {
      if (!rawMode) return c.json({ error: "permissionMode must be a non-empty string" }, 400);
      const nextMode =
        backendType === "codex"
          ? normalizeCodexPermissionProfile(rawMode, "codex-default")
          : isClaudePermissionMode(rawMode)
            ? rawMode
            : null;
      if (!nextMode) {
        return c.json({ error: `Unsupported permission mode for ${backendType} session: ${rawMode}` }, 400);
      }
      const current =
        backendType === "codex"
          ? normalizeCodexPermissionProfile(
              liveStateValue<string>(liveState, "permissionMode", info.permissionMode),
              "codex-default",
            )
          : liveStateValue<string>(liveState, "permissionMode", info.permissionMode) || "default";
      if (changed(current, nextMode)) {
        launchPatch.permissionMode = nextMode;
        launchPatch.askPermission = deriveAskPermissionForMode(backendType === "codex" ? "codex" : "claude", nextMode);
        launchPatch.uiMode = deriveUiModeForMode(backendType === "codex" ? "codex" : "claude", nextMode);
        if (backendType === "codex") launchPatch.codexSandbox = resolveCodexSandboxForPermissionMode(nextMode);
        record("permissionMode", "permissionMode", nextMode);
        statePatch.askPermission = launchPatch.askPermission;
        statePatch.uiMode = launchPatch.uiMode;
      }
    }

    if (backendType === "codex" && hasOwn(body, "codexInternetAccess")) {
      const value = body.codexInternetAccess;
      if (typeof value !== "boolean") return c.json({ error: "codexInternetAccess must be a boolean" }, 400);
      if (
        changed(liveStateValue<boolean>(liveState, "codex_internet_access", info.codexInternetAccess) ?? false, value)
      ) {
        launchPatch.codexInternetAccess = value;
        record("codexInternetAccess", "codex_internet_access", value);
      }
    }

    if (backendType === "codex") {
      const effort = normalizeNullableCodexEffort(
        parseNullableString(body, "codexReasoningEffort"),
        "codexReasoningEffort",
      );
      if (!effort.ok) return c.json({ error: effort.error }, 400);
      if (effort.value !== undefined || hasOwn(body, "codexReasoningEffort")) {
        if (
          changed(liveStateValue<string>(liveState, "codex_reasoning_effort", info.codexReasoningEffort), effort.value)
        ) {
          launchPatch.codexReasoningEffort = effort.value;
          record("codexReasoningEffort", "codex_reasoning_effort", effort.value ?? null);
        }
      }

      const serviceTier = parseNullableString(body, "codexServiceTier");
      if (serviceTier !== undefined) {
        const next = serviceTier || null;
        if (changed(liveStateValue<string>(liveState, "codex_service_tier", info.codexServiceTier) ?? null, next)) {
          launchPatch.codexServiceTier = next;
          record("codexServiceTier", "codex_service_tier", next);
        }
      }

      const maxContext = parseNullablePositiveInteger(body, "codexMaxContextLength");
      if (!maxContext.ok) return c.json({ error: maxContext.error }, 400);
      if (maxContext.value !== undefined) {
        if (
          changed(
            liveStateValue<number>(liveState, "codex_max_context_length", info.codexMaxContextLength),
            maxContext.value,
          )
        ) {
          launchPatch.codexMaxContextLength = maxContext.value ?? undefined;
          record("codexMaxContextLength", "codex_max_context_length", maxContext.value ?? null);
        }
      }
    } else {
      const effort = normalizeNullableEffort(
        parseNullableString(body, "claudeReasoningEffort"),
        CLAUDE_REASONING_EFFORTS,
        "claudeReasoningEffort",
      );
      if (!effort.ok) return c.json({ error: effort.error }, 400);
      if (effort.value !== undefined || hasOwn(body, "claudeReasoningEffort")) {
        if (
          changed(
            liveStateValue<string>(liveState, "claude_reasoning_effort", info.claudeReasoningEffort),
            effort.value,
          )
        ) {
          launchPatch.claudeReasoningEffort = effort.value;
          record("claudeReasoningEffort", "claude_reasoning_effort", effort.value ?? null);
        }
      }

      const maxContext = parseNullablePositiveInteger(body, "claudeMaxContextLength");
      if (!maxContext.ok) return c.json({ error: maxContext.error }, 400);
      if (maxContext.value !== undefined) {
        if (maxContext.value !== null && maxContext.value !== CLAUDE_1M_CONTEXT_TOKENS) {
          return c.json(
            { error: `claudeMaxContextLength currently supports only ${CLAUDE_1M_CONTEXT_TOKENS} or null` },
            400,
          );
        }
        if (
          changed(
            liveStateValue<number>(liveState, "claude_max_context_length", info.claudeMaxContextLength),
            maxContext.value,
          )
        ) {
          launchPatch.claudeMaxContextLength = maxContext.value ?? undefined;
          record("claudeMaxContextLength", "claude_max_context_length", maxContext.value ?? null);
        }
      }
    }

    const restartRequired = restartRequiredFields.length > 0;
    const updatedInfo = launcher.updateSessionLaunchConfig(id, launchPatch) ?? info;

    if (changedFields.length > 0) {
      if (backendConnected && !restartRequired) {
        if (changedFields.includes("model") && typeof launchPatch.model === "string") {
          await wsBridge.setSessionModel(id, launchPatch.model);
        }
        if (changedFields.includes("permissionMode") && typeof launchPatch.permissionMode === "string") {
          await wsBridge.setSessionPermissionMode(id, launchPatch.permissionMode);
        }
        if (backendType === "codex" && changedFields.includes("codexServiceTier")) {
          await wsBridge.setCodexServiceTier(id, launchPatch.codexServiceTier ?? null);
        }
      } else {
        Object.assign(session.state, statePatch);
        wsBridge.broadcastToSession(id, { type: "session_update", session: statePatch } as never);
        wsBridge.persistSessionById(id);
      }
    }

    return c.json({
      ok: true,
      sessionId: id,
      backendConnected,
      restartRequired,
      restartRequiredFields,
      immediateFields,
      changedFields,
      session: buildSessionConfigResponse(updatedInfo),
      sessionState: statePatch,
    });
  });
}
