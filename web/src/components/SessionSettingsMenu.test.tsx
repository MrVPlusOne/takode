// @vitest-environment jsdom
/**
 * The session settings menu: the one label in the session title (model, effort, access) and the
 * menu it opens. Ported from the composer toolbar's model and permission selectors when these
 * controls moved to the title; the harness feeds producer-shaped model catalogs through
 * `buildSessionSettings`, the same builder the live hook uses.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSessionSettings, SessionSettingsMenu } from "./SessionSettingsMenu.js";
import type { ModelOption } from "../utils/backends.js";

const FAST_TIER = { id: "priority", name: "Fast", description: "1.5x speed, increased usage" };
const MODEL_OPTIONS: ModelOption[] = [
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
    icon: "●",
    serviceTiers: [FAST_TIER],
    supportedReasoningLevels: [
      { effort: "medium", description: "Balanced reasoning" },
      { effort: "ultra", description: "Maximum reasoning" },
    ],
    defaultReasoningLevel: "medium",
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
  { value: "custom-basic", label: "Basic Chat", icon: "◆" },
];

const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort }));
// Shaped like the server's Claude CLI catalog: Haiku has no effort control, so it reports no levels.
const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { value: "claude-opus-5.5", label: "Opus 5.5 (default)", icon: "◆", supportedReasoningLevels: CLAUDE_LEVELS },
  { value: "claude-haiku-4.5", label: "Haiku 4.5", icon: "⚡", supportedReasoningLevels: [] },
];

function SettingsHarness({
  backend = "codex",
  initialModel = backend === "codex" ? "gpt-5.6-sol" : "claude-opus-5.5",
  initialEffort = "ultra",
  initialTier = "priority",
  effectiveEffort = initialEffort,
  effectiveReported = true,
  permissionMode = backend === "codex" ? "bypassPermissions" : "acceptEdits",
  connected = true,
  onReset = async () => {},
  onSend = () => {},
}: {
  backend?: "claude" | "codex";
  initialModel?: string;
  initialEffort?: string;
  initialTier?: string | null;
  effectiveEffort?: string | null;
  effectiveReported?: boolean;
  permissionMode?: string;
  connected?: boolean;
  onReset?: () => Promise<void>;
  onSend?: (message: unknown) => void;
}) {
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState(initialEffort);
  const [runtimeEffort, setRuntimeEffort] = useState(effectiveEffort);
  const [runtimeReported, setRuntimeReported] = useState(effectiveReported);
  const [tier, setTier] = useState<string | null>(initialTier);
  const fastTier = MODEL_OPTIONS.find((option) => option.value === model)?.serviceTiers?.[0] ?? null;
  const settings = buildSessionSettings({
    view: {
      backendType: backend === "codex" ? "codex" : "claude-sdk",
      isConnected: connected,
      browserConnectionStatus: "connected",
      permissionMode,
      model,
      codexReasoningEffort: backend === "codex" ? effort : "",
      codexEffectiveReasoningEffort: runtimeEffort,
      codexEffectiveReasoningEffortReported: runtimeReported,
      codexServiceTier: tier,
      claudeReasoningEffort: backend === "claude" ? effort : "",
    },
    claudeModels: backend === "claude" ? CLAUDE_MODEL_OPTIONS : [],
    codexModelOptions: backend === "codex" ? MODEL_OPTIONS : [],
    codexFastServiceTier: backend === "codex" ? fastTier : null,
    // Apply each change locally, the way the server's broadcast would.
    send: (message) => {
      onSend(message);
      if (message.type === "set_model") {
        setModel(message.model);
        setRuntimeEffort(null);
        setRuntimeReported(false);
      }
      if (message.type === "set_codex_reasoning_effort" || message.type === "set_claude_reasoning_effort") {
        setEffort(message.effort);
        setRuntimeEffort(null);
        setRuntimeReported(false);
      }
      if (message.type === "set_codex_service_tier") setTier(message.serviceTier);
    },
    resetCodex: onReset,
  });
  // The title's one-line summary beside the menu Session Info shows.
  return (
    <>
      <span data-testid="title-summary" title={settings.title}>
        {settings.summary}
      </span>
      <SessionSettingsMenu settings={settings} />
    </>
  );
}

const summary = () => screen.getByTestId("title-summary");
const menu = () => screen.getByTestId("session-settings-menu");
const row = (name: string) => within(menu()).getByRole("menuitem", { name: new RegExp(name) });

describe("session settings for Codex", () => {
  it("shows one short label and keeps model, effort and speed selections independent", async () => {
    // Each nested list updates only its own session value, then returns to the rows.
    render(<SettingsHarness />);
    const user = userEvent.setup();

    expect(summary().textContent).toBe("5.6 Sol Ultra · Full access");
    expect(row("Model").textContent).toContain("5.6 Sol");
    expect(row("Effort").textContent).toContain("Ultra");
    expect(row("Speed").textContent).toContain("Fast");
    expect(row("Access").textContent).toContain("Full access");

    await user.click(row("Model"));
    await user.click(within(menu()).getByRole("menuitemradio", { name: /5.4 Mini/ }));
    expect(menu().dataset.panel).toBe("summary");
    expect(summary().textContent).toBe("5.4 Mini Ultra · Full access");
    expect(screen.queryByTestId("session-settings-effort-warning")).toBeNull();
    expect(within(menu()).queryByText("Speed")).toBeNull();
    expect(row("Effort").textContent).toContain("Ultra (unavailable)");

    await user.click(row("Effort"));
    expect(within(menu()).getByRole("menuitemradio", { name: /Default \(Low\)/ })).toBeTruthy();
    await user.click(within(menu()).getByRole("menuitemradio", { name: /^Low/ }));
    expect(summary().textContent).toBe("5.4 Mini Low · Full access");
  });

  it("keeps one effort row and shows a compact warning when Codex reports a downgrade", async () => {
    // Runtime authority still detects a High downgrade, but the row keeps the selected Ultra.
    render(<SettingsHarness initialEffort="ultra" effectiveEffort="high" effectiveReported={true} />);
    const user = userEvent.setup();
    expect(summary().textContent).toBe("5.6 Sol Ultra · Full access");
    expect(summary().getAttribute("title")).toBe(
      "Model: gpt-5.6-sol; speed: Fast; Selected: Ultra; runtime: High; access: Full access",
    );
    expect(row("Effort").textContent).toContain("Ultra");
    expect(screen.getByTestId("session-settings-effort-warning").textContent).toContain(
      "Runtime is using High instead of Ultra.",
    );
  });

  it("resets through the supplied authoritative callback", async () => {
    // Reset resolution belongs to the producer, so the menu does not invent default values.
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(<SettingsHarness onReset={onReset} />);
    const user = userEvent.setup();
    expect(summary().textContent).toBe("5.6 Sol Ultra · Full access");
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a reset failure", async () => {
    // A failed settings fetch must not apply guessed defaults or pass silently.
    const onReset = vi.fn().mockRejectedValue(new Error("settings unavailable"));
    render(<SettingsHarness onReset={onReset} />);
    const user = userEvent.setup();
    expect(summary().textContent).toBe("5.6 Sol Ultra · Full access");
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load session defaults");
  });

  it("returns from a list with ArrowLeft or Escape", async () => {
    // Keyboard users get a predictable way back to the rows.
    render(<SettingsHarness />);
    const user = userEvent.setup();
    await user.click(row("Effort"));
    await user.keyboard("{ArrowLeft}");
    expect(menu().dataset.panel).toBe("summary");
    await user.click(row("Model"));
    await user.keyboard("{Escape}");
    expect(menu().dataset.panel).toBe("summary");
  });

  it("omits effort from the label when no effective effort is known", () => {
    // A model without an advertised effective effort still gets a friendly model label,
    // rather than the misleading literal suffix "Default".
    render(
      <SettingsHarness
        initialModel="custom-basic"
        initialEffort=""
        initialTier={null}
        effectiveEffort={null}
        effectiveReported={false}
      />,
    );
    expect(summary().textContent).toBe("Basic Chat · Full access");
  });
});

describe("session settings for Claude", () => {
  it("offers the model's CLI-reported effort levels and shows the chosen effort in the label", async () => {
    // Claude gets the same rows as Codex, without Codex-only Speed, runtime warning and Reset.
    const onSend = vi.fn();
    render(<SettingsHarness backend="claude" initialEffort="" onSend={onSend} />);
    const user = userEvent.setup();

    expect(summary().textContent).toBe("opus-5.5 · Accept edits");
    expect(summary().getAttribute("title")).toBe("Model: claude-opus-5.5; access: Accept edits");
    expect(row("Model").textContent).toContain("Opus 5.5 (default)");
    expect(row("Effort").textContent).toContain("Default");
    expect(within(menu()).queryByText("Speed")).toBeNull();
    expect(within(menu()).queryByText("Reset to default")).toBeNull();

    await user.click(row("Effort"));
    expect(
      within(menu())
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Default", "Low", "Medium", "High", "Extra high", "Max"]);
    await user.click(within(menu()).getByRole("menuitemradio", { name: "Extra high" }));

    expect(onSend).toHaveBeenCalledWith({ type: "set_claude_reasoning_effort", effort: "xhigh" });
    expect(summary().textContent).toBe("opus-5.5 Extra high · Accept edits");
    expect(summary().getAttribute("title")).toBe("Model: claude-opus-5.5; effort: Extra high; access: Accept edits");
  });

  it("hides effort for a model without effort control", async () => {
    // Claude ignores effort on Haiku, so a configured effort is neither offered nor shown.
    render(<SettingsHarness backend="claude" initialEffort="high" />);
    const user = userEvent.setup();
    expect(summary().textContent).toBe("opus-5.5 High · Accept edits");
    await user.click(row("Model"));
    await user.click(within(menu()).getByRole("menuitemradio", { name: /Haiku 4.5/ }));
    expect(summary().textContent).toBe("haiku-4.5 · Accept edits");
    expect(within(menu()).queryByRole("menuitem", { name: /Effort/ })).toBeNull();
  });
});

describe("session settings access level", () => {
  it("asks before changing access, then sends the backend's mode", async () => {
    // A new access level restarts the backend, so the menu confirms first; Cancel goes back.
    const onSend = vi.fn();
    render(<SettingsHarness backend="claude" initialEffort="" onSend={onSend} />);
    const user = userEvent.setup();
    expect(summary().textContent).toBe("opus-5.5 · Accept edits");
    await user.click(row("Access"));
    const choices = within(menu()).getAllByRole("menuitemradio");
    await user.click(choices.find((item) => item.getAttribute("aria-checked") === "false")!);
    const confirm = screen.getByTestId("session-settings-access-confirm");
    expect(confirm.textContent).toContain("This will restart the CLI session.");
    expect(onSend).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Restart" }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: "set_permission_mode" }));
    expect(menu().dataset.panel).toBe("summary");
  });

  it("says changes apply on resume while the backend is not running", async () => {
    render(<SettingsHarness backend="claude" initialEffort="" connected={false} />);
    const user = userEvent.setup();
    expect(summary().getAttribute("title")).toContain("(changes apply on resume)");
    expect(menu().textContent).toContain("Changes apply when the session resumes.");
  });
});

describe("session settings focus", () => {
  it("leaves focus alone until used, then follows the open list", async () => {
    // Opening Session Info must not focus (and highlight) the first row; once a row is
    // opened, keyboard focus moves into its list.
    render(<SettingsHarness backend="claude" initialEffort="" />);
    expect(document.activeElement).toBe(document.body);
    await userEvent.click(row("Effort"));
    expect(menu().contains(document.activeElement)).toBe(true);
  });
});
