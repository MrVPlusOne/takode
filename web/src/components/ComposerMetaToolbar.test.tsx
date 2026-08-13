// @vitest-environment jsdom
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposerMetaToolbar } from "./ComposerMetaToolbar.js";
import { CODEX_PERMISSION_MODES, type ModelOption } from "../utils/backends.js";

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
  {
    value: "custom-basic",
    label: "Basic Chat",
    icon: "◆",
  },
];

function ToolbarHarness({
  initialModel = "gpt-5.6-sol",
  initialEffort = "ultra",
  initialTier = "priority",
  effectiveEffort = initialEffort,
  effectiveReported = true,
  onReset = async () => {},
}: {
  initialModel?: string;
  initialEffort?: string;
  initialTier?: string | null;
  effectiveEffort?: string | null;
  effectiveReported?: boolean;
  onReset?: () => Promise<void>;
}) {
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState(initialEffort);
  const [runtimeEffort, setRuntimeEffort] = useState(effectiveEffort);
  const [runtimeReported, setRuntimeReported] = useState(effectiveReported);
  const [tier, setTier] = useState<string | null>(initialTier);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const permissionDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedModel = MODEL_OPTIONS.find((option) => option.value === model);
  const fastTier = selectedModel?.serviceTiers?.[0] ?? null;

  return (
    <div className="w-[320px]">
      <ComposerMetaToolbar
        sessionId="session-1"
        sessionView={{ model, gitAhead: 0, gitBehind: 0 }}
        isCodex={true}
        isConnected={true}
        canEditLaunchSettings={true}
        imageUploadDisabled={false}
        imageUploadTitle="Upload image"
        showModelDropdown={showModelDropdown}
        setShowModelDropdown={setShowModelDropdown}
        modelDropdownRef={modelDropdownRef}
        claudeModelOptions={[]}
        codexModelOptions={MODEL_OPTIONS}
        onSelectModel={(next) => {
          setModel(next);
          setRuntimeEffort(null);
          setRuntimeReported(false);
        }}
        codexReasoningEffort={effort}
        codexEffectiveReasoningEffort={runtimeEffort}
        codexEffectiveReasoningEffortReported={runtimeReported}
        onSelectCodexReasoning={(next) => {
          setEffort(next);
          setRuntimeEffort(null);
          setRuntimeReported(false);
        }}
        codexServiceTier={tier}
        codexFastServiceTier={fastTier}
        onSelectCodexServiceTier={setTier}
        onResetCodexSettings={onReset}
        permissionOptions={CODEX_PERMISSION_MODES}
        permissionMode="default"
        showPermissionDropdown={false}
        setShowPermissionDropdown={() => {}}
        permissionDropdownRef={permissionDropdownRef}
        pendingPermissionMode={null}
        onRequestPermissionMode={() => {}}
        onCancelPermissionMode={() => {}}
        onConfirmPermissionMode={() => {}}
        collapseAllButton={null}
        pauseControl={null}
        onOpenFilePicker={() => {}}
        warmMicrophone={() => {}}
        voiceSupported={true}
        toggleVoiceUnsupportedInfo={() => {}}
        handleMicClick={() => {}}
        voiceButtonDisabled={false}
        isPreparing={false}
        isRecording={false}
        voiceButtonTitle="Voice input"
        canSend={true}
        isRunning={false}
        handleInterrupt={() => {}}
        handleSend={() => {}}
        sendButtonTitle="Send"
        sendPressing={false}
      />
    </div>
  );
}

describe("ComposerMetaToolbar Codex model selector", () => {
  it("shows a friendly combined label and keeps model, effort, and speed selections independent", async () => {
    // This covers the requested two-level hierarchy: each nested selector updates
    // only its own producer-shaped session value, then returns to the summary.
    render(<ToolbarHarness />);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Model and effort: 5.6 Sol Ultra" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Model and effort: 5.6 Sol Ultra" }));

    const summary = screen.getByTestId("composer-model-summary-menu");
    expect(within(summary).getByText("5.6 Sol")).toBeTruthy();
    expect(within(summary).getByRole("menuitem", { name: /Requested/ }).textContent).toContain("Ultra");
    expect(within(summary).getByText("Fast")).toBeTruthy();

    await user.click(within(summary).getByRole("menuitem", { name: /Model/ }));
    const models = screen.getByTestId("composer-model-options-menu");
    await user.click(within(models).getByRole("menuitemradio", { name: /5.4 Mini/ }));
    expect(screen.getByTestId("composer-model-menu").dataset.codexPanel).toBe("summary");
    expect(screen.getByRole("button", { name: "Model and effort: 5.4 Mini Ultra requested" })).toBeTruthy();
    expect(within(screen.getByTestId("composer-model-summary-menu")).queryByText("Speed")).toBeNull();
    expect(within(screen.getByTestId("composer-model-summary-menu")).getByText("Ultra (unavailable)")).toBeTruthy();

    await user.click(
      within(screen.getByTestId("composer-model-summary-menu")).getByRole("menuitem", { name: /Requested/ }),
    );
    const efforts = screen.getByTestId("composer-reasoning-menu");
    expect(within(efforts).getByRole("menuitemradio", { name: /Default \(Low\)/ })).toBeTruthy();
    expect(within(efforts).getByRole("menuitemradio", { name: /Quick reasoning/ })).toBeTruthy();
    await user.click(within(efforts).getByRole("menuitemradio", { name: /^Low Quick reasoning$/ }));
    expect(screen.getByRole("button", { name: "Model and effort: 5.4 Mini Low requested" })).toBeTruthy();
  });

  it("shows requested and effective effort separately when Codex reports a downgrade", async () => {
    // A requested Ultra value must not be rendered as effective when Codex reports High.
    render(<ToolbarHarness initialEffort="ultra" effectiveEffort="high" effectiveReported={true} />);
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Model and effort: 5.6 Sol High · Ultra requested" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Model and effort: 5.6 Sol High · Ultra requested" }));
    const summary = screen.getByTestId("composer-model-summary-menu");
    expect(within(summary).getByRole("menuitem", { name: /Requested/ }).textContent).toContain("Ultra");
    expect(within(summary).getByTestId("composer-effective-reasoning").textContent).toContain("High");
  });

  it("resets through the supplied authoritative callback and closes only after it succeeds", async () => {
    // Reset resolution belongs to the producer (Composer/server settings path),
    // so this component test verifies the menu does not invent default values.
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(<ToolbarHarness onReset={onReset} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Model and effort: 5.6 Sol Ultra" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset to default" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("composer-model-menu")).toBeNull();
  });

  it("keeps the selector open and reports a reset failure", async () => {
    // A failed settings fetch must not silently apply guessed frontend defaults
    // or close the menu as if the authoritative reset succeeded.
    const onReset = vi.fn().mockRejectedValue(new Error("settings unavailable"));
    render(<ToolbarHarness onReset={onReset} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Model and effort: 5.6 Sol Ultra" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset to default" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load session defaults");
    expect(screen.getByTestId("composer-model-menu")).toBeTruthy();
  });

  it("returns from nested menus with ArrowLeft and closes the summary with Escape", async () => {
    // Keyboard users must have a predictable submenu return path and a second
    // Escape that closes the whole selector while restoring trigger focus.
    render(<ToolbarHarness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Model and effort: 5.6 Sol Ultra" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Requested/ }));
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("composer-model-menu").dataset.codexPanel).toBe("summary");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("composer-model-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("omits effort from the closed label when no effective effort is known", () => {
    // A backend/model without an advertised effective effort still gets a useful
    // friendly model label, rather than the misleading literal suffix "Default".
    render(
      <ToolbarHarness
        initialModel="custom-basic"
        initialEffort=""
        initialTier={null}
        effectiveEffort={null}
        effectiveReported={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Model and effort: Basic Chat" })).toBeTruthy();
  });
});
