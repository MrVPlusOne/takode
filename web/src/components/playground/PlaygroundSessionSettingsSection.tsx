import { useState } from "react";
import type { ModelOption } from "../../utils/backends.js";
import { buildSessionSettings, SessionSettingsMenu, type SessionSettingsInput } from "../SessionSettingsMenu.js";

type FixtureView = SessionSettingsInput["view"];

const FAST_TIER = { id: "priority", name: "Fast", description: "1.5x speed, increased usage" };
const CODEX_MODELS: ModelOption[] = [
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
    icon: "●",
    serviceTiers: [FAST_TIER],
    supportedReasoningLevels: [
      { effort: "medium", description: "Balanced reasoning" },
      { effort: "high", description: "Deep reasoning" },
      { effort: "ultra", description: "Maximum reasoning" },
    ],
    defaultReasoningLevel: "high",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4-Mini",
    icon: "⚡",
    supportedReasoningLevels: [
      { effort: "low", description: "Quick reasoning" },
      { effort: "medium", description: "Balanced reasoning" },
    ],
    defaultReasoningLevel: "low",
  },
];
const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort }));
const CLAUDE_MODELS: ModelOption[] = [
  { value: "claude-opus-5.5", label: "Opus 5.5 (default)", icon: "◆", supportedReasoningLevels: CLAUDE_LEVELS },
  { value: "claude-sonnet-5.5", label: "Sonnet 5.5", icon: "●", supportedReasoningLevels: CLAUDE_LEVELS },
  { value: "claude-haiku-4.5", label: "Haiku 4.5", icon: "⚡", supportedReasoningLevels: [] },
];

const CLAUDE_VIEW: FixtureView = {
  backendType: "claude-sdk",
  isConnected: true,
  browserConnectionStatus: "connected",
  permissionMode: "bypassPermissions",
  model: "claude-opus-5.5",
  codexReasoningEffort: "",
  codexEffectiveReasoningEffort: null,
  codexEffectiveReasoningEffortReported: false,
  codexServiceTier: null,
  claudeReasoningEffort: "xhigh",
};
// Codex reports it is running at High while Ultra is selected, so the effort warning shows.
const CODEX_VIEW: FixtureView = {
  ...CLAUDE_VIEW,
  backendType: "codex",
  permissionMode: "codex-full-access",
  model: "gpt-5.6-sol",
  codexReasoningEffort: "ultra",
  codexEffectiveReasoningEffort: "high",
  codexEffectiveReasoningEffortReported: true,
  codexServiceTier: "priority",
  claudeReasoningEffort: "",
};

/** Builds settings the way the live hook does; changes only update this preview's state. */
function useFixtureSettings(initial: FixtureView) {
  const [view, setView] = useState(initial);
  return buildSessionSettings({
    view,
    claudeModels: CLAUDE_MODELS,
    codexModelOptions: CODEX_MODELS,
    codexFastServiceTier: CODEX_MODELS.find((m) => m.value === view.model)?.serviceTiers?.[0] ?? null,
    send: (message) => {
      if (message.type === "set_model") setView((v) => ({ ...v, model: message.model }));
      if (message.type === "set_claude_reasoning_effort")
        setView((v) => ({ ...v, claudeReasoningEffort: message.effort }));
      if (message.type === "set_codex_reasoning_effort")
        setView((v) => ({ ...v, codexReasoningEffort: message.effort, codexEffectiveReasoningEffort: null }));
      if (message.type === "set_codex_service_tier") setView((v) => ({ ...v, codexServiceTier: message.serviceTier }));
      if (message.type === "set_permission_mode") setView((v) => ({ ...v, permissionMode: message.mode }));
    },
    resetCodex: async () => setView(initial),
  });
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-card p-3">
      <div className="mb-2 text-[11px] font-medium text-cc-muted">{label}</div>
      {children}
    </div>
  );
}

function SettingsPreview({ view, initialPanel }: { view: FixtureView; initialPanel?: "summary" | "access" }) {
  const settings = useFixtureSettings(view);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="w-72 rounded-[12px] border border-cc-border bg-cc-card p-1.5 shadow-lg">
        <SessionSettingsMenu settings={settings} initialPanel={initialPanel} />
      </div>
      <div className="pt-1 text-[11px] text-cc-muted">
        In the title: <span data-testid="session-settings-summary">{settings.summary}</span>
      </div>
    </div>
  );
}

/**
 * The session settings menu at the top of Session Info, with the one-line summary the session
 * title shows (model, effort, access).
 */
export function PlaygroundSessionSettingsCards() {
  return (
    <div className="space-y-4">
      <Card label="Session settings — Claude">
        <SettingsPreview view={CLAUDE_VIEW} />
      </Card>
      <Card label="Session settings — Codex with speed and an effort warning">
        <SettingsPreview view={CODEX_VIEW} />
      </Card>
      <Card label="Access list — Claude">
        <SettingsPreview view={{ ...CLAUDE_VIEW, permissionMode: "acceptEdits" }} initialPanel="access" />
      </Card>
      <Card label="Access list — Claude with a retired saved mode">
        <SettingsPreview view={{ ...CLAUDE_VIEW, permissionMode: "dontAsk" }} initialPanel="access" />
      </Card>
      <Card label="Session settings — backend stopped (changes apply on resume)">
        <SettingsPreview view={{ ...CLAUDE_VIEW, isConnected: false, model: "claude-sonnet-5.5" }} />
      </Card>
    </div>
  );
}
