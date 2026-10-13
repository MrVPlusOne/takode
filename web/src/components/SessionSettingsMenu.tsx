/**
 * A session's model, reasoning effort, Codex speed and access level. The session title shows
 * them as one short line ("opus-5.5 High · Full access"); the settings menu at the top of
 * Session Info changes them. Works for Claude and Codex.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type BackendModelInfo } from "../api.js";
import {
  CODEX_PERMISSION_MODES,
  deriveCodexPermissionMode,
  formatModel,
  getClaudePermissionMenuOptions,
  getClaudeReasoningEffortOptions,
  getCodexReasoningEffortOptions,
  getModelsForBackend,
  labelForReasoningEffort,
  normalizeClaudePermission,
  resolveClaudePermissionCliMode,
  resolveCodexPermissionCliMode,
  toModelOptions,
  type ClaudePermissionMode,
  type CodexPermissionMode,
  type ModelOption,
  type PermissionOption,
} from "../utils/backends.js";
import { buildCodexReasoningAuthorityDisplay } from "../utils/codex-reasoning-display.js";
import { sendToSession } from "../ws.js";
import { useCodexModelOptions } from "./use-codex-model-options.js";
import { useComposerSessionView } from "./use-composer-session-view.js";
import { useResetCodexModelSettings } from "./use-reset-codex-model-settings.js";

export interface SessionSettingsChoice {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface SessionSettings {
  isCodex: boolean;
  /** The backend is running; changes apply now rather than on resume. */
  isConnected: boolean;
  /** Takode is reachable, so settings can be changed at all. */
  editable: boolean;
  hasModel: boolean;
  model: { value: string; label: string; choices: SessionSettingsChoice[] };
  /** Null when the model has no effort choices (e.g. Haiku). */
  effort: { value: string; label: string; choices: SessionSettingsChoice[] } | null;
  /** Codex models with a fast service tier only. */
  speed: { fast: boolean; label: string; choices: SessionSettingsChoice[] } | null;
  access: { value: string; label: string; choices: PermissionOption[] };
  /** Codex: the runtime is not honoring the requested effort. */
  effortWarning: string | null;
  /** The one-line label for the title: model, effort, access. */
  summary: string;
  /** Hover text with the full details. */
  title: string;
  setModel: (model: string) => void;
  setEffort: (effort: string) => void;
  setSpeed: (fast: boolean) => void;
  /** Access changes restart the backend, so they are confirmed first (see `confirmAccess`). */
  setAccess: (mode: string) => void;
  /** Codex only: back to the session defaults for its role. */
  resetCodex: (() => Promise<void>) | null;
}

/**
 * Reads a session's settings and how to change them. It loads the model catalogs and keeps a
 * Codex speed the model no longer offers off.
 */
export function useSessionSettings(sessionId: string): SessionSettings {
  const view = useComposerSessionView(sessionId);
  const isCodex = view.backendType === "codex";
  const claudeModels = useClaudeModelOptions(isCodex, view.model);
  const loadSettings = useCallback(() => api.getSettings().catch(() => null), []);
  const { codexModelOptions, codexFastServiceTier } = useCodexModelOptions({
    isCodex,
    model: view.model,
    codexServiceTier: view.codexServiceTier,
    sessionId,
    loadPersistedSettings: loadSettings,
  });
  const resetCodex = useResetCodexModelSettings({
    sessionId,
    isLeaderSession: view.isLeaderSession,
    model: view.model,
    reasoningEffort: view.codexReasoningEffort,
    serviceTier: view.codexServiceTier,
  });
  return buildSessionSettings({
    view,
    claudeModels,
    codexModelOptions,
    codexFastServiceTier,
    send: (message) => sendToSession(sessionId, message),
    resetCodex,
  });
}

export interface SessionSettingsInput {
  view: Pick<
    ReturnType<typeof useComposerSessionView>,
    | "backendType"
    | "isConnected"
    | "browserConnectionStatus"
    | "permissionMode"
    | "model"
    | "codexReasoningEffort"
    | "codexEffectiveReasoningEffort"
    | "codexEffectiveReasoningEffortReported"
    | "codexServiceTier"
    | "claudeReasoningEffort"
  >;
  claudeModels: ModelOption[];
  codexModelOptions: ModelOption[];
  codexFastServiceTier: NonNullable<ModelOption["serviceTiers"]>[number] | null;
  /** Sends a settings change to the session's backend. */
  send: (message: Parameters<typeof sendToSession>[1]) => void;
  resetCodex: () => Promise<void>;
}

/** The labels, choices and actions for a session's settings, from its state and model catalogs. */
export function buildSessionSettings({
  view,
  claudeModels,
  codexModelOptions,
  codexFastServiceTier,
  send,
  resetCodex,
}: SessionSettingsInput): SessionSettings {
  const isCodex = view.backendType === "codex";

  const accessChoices = isCodex
    ? CODEX_PERMISSION_MODES
    : getClaudePermissionMenuOptions(normalizeClaudePermission(view.permissionMode));
  const accessValue = isCodex
    ? deriveCodexPermissionMode(view.permissionMode)
    : normalizeClaudePermission(view.permissionMode);
  const access = accessChoices.find((option) => option.value === accessValue) ?? accessChoices[0]!;

  let model: SessionSettings["model"];
  let effort: SessionSettings["effort"];
  let effortWarning: string | null = null;
  let effortTitle = "";
  let codexEffortSuffix = "";
  if (isCodex) {
    const selected = codexModelOptions.find((option) => option.value === view.model);
    const supported = selected?.supportedReasoningLevels?.map((level) => level.effort) ?? null;
    const current = view.codexReasoningEffort.trim().toLowerCase();
    const all = getCodexReasoningEffortOptions({
      modelOptions: codexModelOptions,
      model: view.model,
      currentEffort: view.codexReasoningEffort,
    });
    const offered = all.filter((option) => !option.value || !supported?.length || supported.includes(option.value));
    const labelFor = (value: string) =>
      getCodexReasoningEffortOptions({
        modelOptions: codexModelOptions,
        model: view.model,
        currentEffort: value,
        includeDefault: false,
      }).find((option) => option.value === value)?.label || value;
    const defaultValue = selected?.defaultReasoningLevel?.trim().toLowerCase() || "";
    const defaultLabel = defaultValue ? labelFor(defaultValue) : "";
    const advertised = !current || !supported?.length || supported.includes(current);
    const authority = buildCodexReasoningAuthorityDisplay({
      requested: view.codexReasoningEffort,
      effective: view.codexEffectiveReasoningEffort,
      effectiveReported: view.codexEffectiveReasoningEffortReported,
      runtimeConnected: view.isConnected,
      defaultRequested: defaultValue,
      defaultRequestedLabel: defaultLabel,
      labelForEffort: labelFor,
    });
    effortWarning = authority.warningLabel || null;
    effortTitle = authority.title;
    codexEffortSuffix = authority.triggerSuffix;
    model = {
      value: view.model ?? "",
      label: friendlyCodexModelLabel(selected?.label || view.model || "Model"),
      choices: codexModelOptions
        .filter((option) => option.value)
        .map((option) => ({ value: option.value, label: friendlyCodexModelLabel(option.label), icon: option.icon })),
    };
    effort = {
      value: view.codexReasoningEffort,
      label: current
        ? advertised
          ? offered.find((option) => option.value === current)?.label || current
          : `${labelFor(current)} (unavailable)`
        : defaultLabel
          ? `${defaultLabel} (default)`
          : "Default",
      choices: offered.map((option) => ({
        value: option.value,
        label: !option.value && defaultLabel ? `Default (${defaultLabel})` : option.label,
        description: option.description,
      })),
    };
  } else {
    const selected = claudeModels.find((option) => option.value === view.model);
    const options = getClaudeReasoningEffortOptions(selected);
    model = {
      value: view.model ?? "",
      // A model missing from the catalog is listed under its raw ID; show the short name instead.
      label: selected && selected.label !== selected.value ? selected.label : formatModel(view.model || ""),
      choices: claudeModels.map((option) => ({ value: option.value, label: option.label, icon: option.icon })),
    };
    // A model without effort control (e.g. Haiku) ignores any configured effort, so don't show it.
    effort =
      options.length > 0
        ? {
            value: view.claudeReasoningEffort,
            label: view.claudeReasoningEffort ? labelForReasoningEffort(view.claudeReasoningEffort) : "Default",
            choices: options.map((option) => ({
              value: option.value,
              label: option.label,
              description: option.description,
            })),
          }
        : null;
  }
  if (effort && !effort.choices.some((choice) => choice.value !== "")) effort = null;

  const fast = !!codexFastServiceTier && view.codexServiceTier === codexFastServiceTier.id;
  const speed: SessionSettings["speed"] =
    isCodex && codexFastServiceTier
      ? {
          fast,
          label: fast ? codexFastServiceTier.name : "Standard",
          choices: [
            { value: "standard", label: "Standard", description: "Default Codex speed." },
            {
              value: codexFastServiceTier.id,
              label: codexFastServiceTier.name,
              description: codexFastServiceTier.description || "Use increased-priority Codex service tier.",
            },
          ],
        }
      : null;

  // The title shows the effort only when it is set or matters, keeping the label short.
  // The title label keeps model and effort together ("5.6 Sol Ultra", "opus-5.5 High"), then
  // the access level. Codex shows the effort it reports running at; Claude its chosen effort.
  const shortModel = isCodex ? model.label : formatModel(view.model || "");
  const shortEffort = isCodex
    ? codexEffortSuffix
    : effort && view.claudeReasoningEffort
      ? labelForReasoningEffort(view.claudeReasoningEffort)
      : "";
  const summary = [view.model ? [shortModel, shortEffort].filter(Boolean).join(" ") : "", access.label]
    .filter(Boolean)
    .join(" · ");
  const title =
    [
      `Model: ${view.model || "unknown"}`,
      speed ? `speed: ${speed.label}` : "",
      isCodex ? effortTitle : shortEffort ? `effort: ${shortEffort}` : "",
      `access: ${access.label}`,
    ]
      .filter(Boolean)
      .join("; ") + (view.isConnected ? "" : " (changes apply on resume)");

  return {
    isCodex,
    isConnected: view.isConnected,
    editable: view.browserConnectionStatus === "connected",
    hasModel: !!view.model,
    model,
    effort,
    speed,
    access: { value: accessValue, label: access.label, choices: accessChoices },
    effortWarning,
    summary,
    title,
    setModel: (value) => send({ type: "set_model", model: value }),
    setEffort: (value) =>
      send(
        isCodex
          ? { type: "set_codex_reasoning_effort", effort: value }
          : { type: "set_claude_reasoning_effort", effort: value },
      ),
    setSpeed: (toFast) =>
      send({
        type: "set_codex_service_tier",
        serviceTier: toFast && codexFastServiceTier ? codexFastServiceTier.id : null,
      }),
    setAccess: (mode) =>
      send({
        type: "set_permission_mode",
        mode: isCodex
          ? resolveCodexPermissionCliMode(mode as CodexPermissionMode)
          : resolveClaudePermissionCliMode(mode as ClaudePermissionMode),
      }),
    resetCodex: isCodex ? resetCodex : null,
  };
}

type MenuPanel = "summary" | "model" | "effort" | "speed" | "access" | "confirm";

/**
 * The settings menu: one row per setting with its current value; a row opens its choices,
 * and choosing returns to the rows. Access asks before restarting the backend.
 */
export function SessionSettingsMenu({
  settings,
  initialPanel = "summary",
}: {
  settings: SessionSettings;
  /** The list shown first; the Playground opens Access to document it. */
  initialPanel?: "summary" | "access";
}) {
  const [panel, setPanel] = useState<MenuPanel>(initialPanel);
  const [pendingAccess, setPendingAccess] = useState<PermissionOption | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const disabled = !settings.editable;

  // Opening Session Info leaves focus alone; once a row is used, focus follows the open list.
  const focusedPanel = useRef<MenuPanel>(panel);
  useEffect(() => {
    if (focusedPanel.current === panel) return;
    focusedPanel.current = panel;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [panel]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key === "Escape" || event.key === "ArrowLeft") && panel !== "summary") {
      event.preventDefault();
      event.stopPropagation();
      setPanel("summary");
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }

  async function reset() {
    if (!settings.resetCodex || resetting) return;
    setResetting(true);
    setResetError("");
    try {
      await settings.resetCodex();
    } catch {
      setResetError("Couldn’t load session defaults. Try again.");
    } finally {
      setResetting(false);
    }
  }

  const back = (label: string) => (
    <button
      type="button"
      onClick={() => setPanel("summary")}
      className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:bg-cc-hover focus-visible:outline-none"
    >
      <Chevron direction="left" /> {label}
    </button>
  );
  const choice = (
    item: SessionSettingsChoice,
    selected: boolean,
    onChoose: () => void,
    testValue = item.value || "default",
  ) => (
    <button
      key={testValue}
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-settings-choice={testValue}
      onClick={onChoose}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-cc-hover focus-visible:bg-cc-hover focus-visible:outline-none ${
        selected ? "text-cc-primary" : "text-cc-fg"
      }`}
    >
      {item.icon !== undefined && <span className="w-4 shrink-0 text-center text-xs">{item.icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{item.label}</span>
        {item.description && (
          <span className="mt-0.5 block text-[11px] leading-snug text-cc-muted">{item.description}</span>
        )}
      </span>
    </button>
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Session settings"
      data-testid="session-settings-menu"
      data-panel={panel}
      onKeyDown={onKeyDown}
    >
      {panel === "summary" && (
        <>
          {settings.hasModel && (
            <SummaryRow
              label="Model"
              value={settings.model.label}
              disabled={disabled}
              onOpen={() => setPanel("model")}
            />
          )}
          {settings.effort && (
            <SummaryRow
              label="Effort"
              value={settings.effort.label}
              disabled={disabled}
              onOpen={() => setPanel("effort")}
            />
          )}
          {settings.effortWarning && (
            <div
              role="status"
              data-testid="session-settings-effort-warning"
              className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-cc-warning/25 bg-cc-warning/10 px-2.5 py-2 text-[11px] leading-snug text-cc-warning"
            >
              <span aria-hidden="true" className="mt-px shrink-0 font-semibold">
                !
              </span>
              <span>{settings.effortWarning}</span>
            </div>
          )}
          {settings.speed && (
            <SummaryRow
              label="Speed"
              value={settings.speed.label}
              disabled={disabled}
              onOpen={() => setPanel("speed")}
            />
          )}
          <SummaryRow
            label="Access"
            value={settings.access.label}
            disabled={disabled}
            onOpen={() => setPanel("access")}
          />
          {settings.resetCodex && (
            <>
              <div className="my-1 border-t border-cc-border/70" />
              <button
                type="button"
                onClick={() => void reset()}
                disabled={disabled || resetting}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:bg-cc-hover focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
              >
                {resetting ? "Resetting…" : "Reset to default"}
              </button>
              {resetError && (
                <p role="alert" className="px-3 pb-1 pt-0.5 text-[11px] leading-snug text-cc-error">
                  {resetError}
                </p>
              )}
            </>
          )}
          {(disabled || !settings.isConnected) && (
            <p className="px-3 pb-1 pt-1 text-[11px] text-cc-muted">
              {disabled ? "Reconnect to Takode to change settings." : "Changes apply when the session resumes."}
            </p>
          )}
        </>
      )}
      {panel === "model" && (
        <>
          {back("Model")}
          {settings.model.choices.map((item) =>
            choice(item, item.value === settings.model.value, () => {
              settings.setModel(item.value);
              setPanel("summary");
            }),
          )}
        </>
      )}
      {panel === "effort" && settings.effort && (
        <>
          {back("Effort")}
          {settings.effort.choices.map((item) =>
            choice(item, item.value === settings.effort!.value, () => {
              settings.setEffort(item.value);
              setPanel("summary");
            }),
          )}
        </>
      )}
      {panel === "speed" && settings.speed && (
        <>
          {back("Speed")}
          {settings.speed.choices.map((item, index) =>
            choice(item, (index === 1) === settings.speed!.fast, () => {
              settings.setSpeed(index === 1);
              setPanel("summary");
            }),
          )}
        </>
      )}
      {panel === "access" && (
        <>
          {back("Access")}
          {settings.access.choices.map((item) =>
            choice(item, item.value === settings.access.value, () => {
              if (item.value === settings.access.value) return setPanel("summary");
              setPendingAccess(item);
              setPanel("confirm");
            }),
          )}
        </>
      )}
      {panel === "confirm" && pendingAccess && (
        <div className="p-2" data-testid="session-settings-access-confirm">
          <p className="mb-1 text-xs font-medium text-cc-fg">Change access to {pendingAccess.label}?</p>
          <p className="mb-3 text-[11px] leading-relaxed text-cc-muted">
            {settings.isConnected
              ? "This will restart the CLI session. Any in-progress operation will be interrupted. Your conversation will be preserved."
              : "This will apply when the session resumes. Your conversation will be preserved."}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPendingAccess(null);
                setPanel("access");
              }}
              className="cursor-pointer rounded-md px-2.5 py-1 text-[11px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                settings.setAccess(pendingAccess.value);
                setPendingAccess(null);
                setPanel("summary");
              }}
              className="cursor-pointer rounded-md bg-cc-primary/15 px-2.5 py-1 text-[11px] font-medium text-cc-primary transition-colors hover:bg-cc-primary/25"
            >
              {settings.isConnected ? "Restart" : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  disabled,
  onOpen,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onOpen}
      disabled={disabled}
      data-settings-row={label.toLowerCase()}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-cc-fg transition-colors hover:bg-cc-hover focus-visible:bg-cc-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-sm">{label}</span>
      <span className="ml-auto max-w-[11rem] truncate text-sm text-cc-muted">{value}</span>
      <span className="shrink-0 text-cc-muted">
        <Chevron direction="right" />
      </span>
    </button>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path
        d={direction === "right" ? "M6 3.5L10.5 8 6 12.5" : "M10 3.5L5.5 8 10 12.5"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function friendlyCodexModelLabel(label: string): string {
  const normalized = label
    .trim()
    .replace(/^gpt[-\s]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return label;
  return normalized
    .split(" ")
    .map((part) => (/^\d/.test(part) ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}

/**
 * Claude's model choices: the CLI's catalog, else the built-in list, with the user's configured
 * default first when the catalog has none, and the running model kept even when unlisted.
 */
function useClaudeModelOptions(isCodex: boolean, currentModel: string | undefined): ModelOption[] {
  const [dynamic, setDynamic] = useState<ModelOption[] | null>(null);
  useEffect(() => {
    if (isCodex) return;
    let cancelled = false;
    const loadModels = api.getBackendModels("claude").catch(() => [] as BackendModelInfo[]);
    Promise.all([loadModels, api.getSettings().catch(() => null)]).then(([models, settings]) => {
      if (cancelled) return;
      const options = models.length > 0 ? toModelOptions(models) : [];
      const defaultModel = models.some((m) => m.isDefault) ? undefined : settings?.claudeDefaultModel;
      if (defaultModel) {
        const base = options.length > 0 ? options : getModelsForBackend("claude").filter((m) => m.value !== "");
        setDynamic([{ value: defaultModel, label: `Default (${defaultModel})`, icon: "◆" }, ...base]);
      } else if (options.length > 0) {
        setDynamic(options);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isCodex]);
  const options = (dynamic || getModelsForBackend("claude")).filter((m) => m.value !== "");
  if (currentModel && !options.some((m) => m.value === currentModel)) {
    return [{ value: currentModel, label: currentModel, icon: "" }, ...options];
  }
  return options;
}
