// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerStatusBlocks } from "./ComposerStatusBlocks.js";

let mockAbsolutePath = "/workspace/project/web/src/components/Composer.tsx";

vi.mock("../store.js", () => ({
  useStore: <T,>(selector: (state: { vscodeSelectionContext: { selection: { absolutePath: string } } }) => T) =>
    selector({
      vscodeSelectionContext: {
        selection: {
          absolutePath: mockAbsolutePath,
        },
      },
    }),
}));

function createStatusBlockProps(overrides: Partial<Parameters<typeof ComposerStatusBlocks>[0]> = {}) {
  return {
    isPreparing: false,
    isRecording: false,
    isTranscribing: false,
    transcriptionPhase: null,
    volumeLevel: 0,
    volumeHistory: [],
    voiceCaptureMode: "dictation",
    voiceUnsupportedInfoOpen: false,
    voiceUnsupportedMessage: null,
    voiceError: null,
    failedTranscription: null,
    voiceEditProposal: null,
    alternateVoiceRerun: null,
    replyContext: null,
    vscodeSelectionLabel: "Composer.tsx:12-14",
    vscodeSelectionSummary: "3 lines selected",
    vscodeSelectionTitle: "[user selection in VSCode: web/src/components/Composer.tsx lines 12-14]",
    onRetryTranscription: vi.fn(),
    onDismissVoiceError: vi.fn(),
    onAcceptVoiceEdit: vi.fn(),
    onUndoVoiceEdit: vi.fn(),
    onRerunAlternateVoiceMode: vi.fn(),
    onDismissUnsupportedInfo: vi.fn(),
    onDismissReply: vi.fn(),
    onDismissVsCodeSelection: vi.fn(),
    onSetVoiceModeEdit: vi.fn(),
    onSetVoiceModeAppend: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof ComposerStatusBlocks>[0];
}

function renderStatusBlocks(overrides: Partial<Parameters<typeof ComposerStatusBlocks>[0]> = {}) {
  const props = createStatusBlockProps(overrides);
  render(<ComposerStatusBlocks {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  mockAbsolutePath = "/workspace/project/web/src/components/Composer.tsx";
  vi.clearAllMocks();
});

describe("ComposerStatusBlocks voice recording controls", () => {
  it("shows the edit/append selector immediately before the recording label and wires both actions", async () => {
    // q-453: the current voice mode needs to be visible next to the active
    // recording label so users can catch edit-vs-append mistakes before speaking.
    const props = renderStatusBlocks({
      isRecording: true,
      voiceCaptureMode: "edit",
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    const modeToggle = screen.getByTestId("voice-capture-mode-toggle");
    const recordingLabel = screen.getByText("Recording");
    expect(modeToggle.compareDocumentPosition(recordingLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Append" }));

    expect(props.onSetVoiceModeEdit).toHaveBeenCalledTimes(1);
    expect(props.onSetVoiceModeAppend).toHaveBeenCalledTimes(1);
  });

  it("renders one fixed waveform meter with the current level as the newest sample", () => {
    // The recording row uses one centered waveform surface so the live level
    // and recent history read as a single compact meter.
    renderStatusBlocks({
      isRecording: true,
      volumeLevel: 0.7,
      volumeHistory: [
        { time: 0, level: 0.08 },
        { time: 125, level: 0.35 },
        { time: 250, level: 0.72 },
      ],
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    expect(screen.queryByLabelText("Current input level")).toBeNull();
    expect(screen.queryByLabelText("Recent input level history")).toBeNull();

    const waveform = screen.getByLabelText("Current and recent input level");
    expect(waveform.className).toContain("items-center");
    expect(waveform.className).toContain("shrink-0");

    const bars = screen.getAllByTestId("voice-level-waveform-bar");
    expect(bars).toHaveLength(40);
    expect(bars[bars.length - 1].getAttribute("data-current-sample")).toBe("true");
    expect(bars[bars.length - 1].getAttribute("data-clipping")).toBeNull();
  });

  it("reserves red waveform bars for clipping-level input", () => {
    // Healthy recording levels stay in the normal copper meter; only an
    // overload-level current sample should trip the clipping marker.
    renderStatusBlocks({
      isRecording: true,
      volumeLevel: 0.99,
      volumeHistory: [
        { time: 0, level: 0.2 },
        { time: 125, level: 0.45 },
      ],
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    const bars = screen.getAllByTestId("voice-level-waveform-bar");
    expect(bars[bars.length - 1].getAttribute("data-current-sample")).toBe("true");
    expect(bars[bars.length - 1].getAttribute("data-clipping")).toBe("true");
  });

  it("labels post-STT no-enhancement transcription as finalizing", () => {
    renderStatusBlocks({
      isTranscribing: true,
      transcriptionPhase: "finalizing",
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    expect(screen.getByText("Finalizing...")).toBeTruthy();
    expect(screen.queryByText("Transcribing...")).toBeNull();
  });

  it("shows the opposite-mode action on voice edit previews", async () => {
    // Voice edit results keep their diff visible while offering the exact other
    // mode, so the user can recover from choosing edit instead of append.
    const props = renderStatusBlocks({
      voiceEditProposal: {
        originalText: "Draft",
        editedText: "Edited draft",
        instructionText: "rewrite it",
      },
      alternateVoiceRerun: {
        resultId: "voice-edit-action",
        blob: new Blob(["voice"], { type: "audio/webm" }),
        sourceMode: "edit",
        composerText: "Draft",
        cursorContext: { before: "Draft", after: "" },
        status: "idle",
      },
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    expect(screen.getByText("Voice edit preview")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Rerun as append" }));

    expect(props.onRerunAlternateVoiceMode).toHaveBeenCalledTimes(1);
  });

  it("dismisses an edit offer without removing its preview and resets for a new result", async () => {
    // Dismissal is presentation-only: the current edit result stays intact, while
    // a later completed result gets a fresh offer even in the same mounted composer.
    const firstBlob = new Blob(["voice-edit"], { type: "audio/webm" });
    const props = createStatusBlockProps({
      voiceEditProposal: {
        originalText: "Draft",
        editedText: "Edited draft",
        instructionText: "rewrite it",
      },
      alternateVoiceRerun: {
        resultId: "voice-result-1",
        blob: firstBlob,
        sourceMode: "edit",
        composerText: "Draft",
        cursorContext: { before: "Draft", after: "" },
        status: "idle",
      },
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });
    const view = render(<ComposerStatusBlocks {...props} />);

    const dismiss = screen.getByRole("button", { name: "Dismiss alternate voice rerun offer" });
    dismiss.focus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("Voice edit preview")).toBeTruthy();
    expect(screen.getByText("Edited draft")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rerun as append" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();

    view.rerender(
      <ComposerStatusBlocks
        {...props}
        voiceEditProposal={null}
        alternateVoiceRerun={{
          resultId: "voice-result-2",
          blob: new Blob(["voice-append"], { type: "audio/webm" }),
          sourceMode: "append",
          composerText: "Draft",
          cursorContext: { before: "Draft", after: "" },
          status: "idle",
        }}
      />,
    );

    expect(screen.getByText("Voice append result ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rerun as voice edit" })).toBeTruthy();
  });

  it("keeps the ordinary offer to one compact row with touch-safe accessible controls", async () => {
    const props = renderStatusBlocks({
      alternateVoiceRerun: {
        resultId: "voice-result-compact",
        blob: new Blob(["voice"], { type: "audio/webm" }),
        sourceMode: "append",
        composerText: "Draft",
        cursorContext: { before: "Draft", after: "" },
        status: "idle",
      },
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    const offer = screen.getByTestId("alternate-voice-rerun-offer");
    expect(offer.className).toContain("min-h-9");
    expect(offer.className).toContain("flex-nowrap");
    expect(offer.className).not.toContain("flex-col");
    expect(screen.getByRole("button", { name: "Rerun as voice edit" }).className).toContain("h-8");
    const dismiss = screen.getByRole("button", { name: "Dismiss alternate voice rerun offer" });
    expect(dismiss.className).toContain("h-8");
    expect(dismiss.className).toContain("w-8");

    await userEvent.click(dismiss);
    expect(screen.queryByTestId("alternate-voice-rerun-offer")).toBeNull();
    expect(props.onRerunAlternateVoiceMode).not.toHaveBeenCalled();
  });

  it("shows alternate rerun errors without disabling retry or the dismiss control", () => {
    renderStatusBlocks({
      alternateVoiceRerun: {
        resultId: "voice-result-error",
        blob: new Blob(["voice"], { type: "audio/webm" }),
        sourceMode: "edit",
        composerText: "Draft",
        cursorContext: { before: "Draft", after: "" },
        status: "error",
        message: "The alternate transcription provider timed out. Try again.",
      },
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    expect(screen.getByRole("status").textContent).toContain("provider timed out");
    expect(screen.getByTestId("alternate-voice-rerun-offer").getAttribute("data-state")).toBe("error");
    expect(screen.getByRole("button", { name: "Rerun as append" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Dismiss alternate voice rerun offer" })).toBeTruthy();
  });

  it("shows disabled alternate rerun status for append results in flight", () => {
    // Append results have no diff card, so the standalone result row owns the
    // loading state while preventing duplicate alternate requests.
    renderStatusBlocks({
      isTranscribing: true,
      alternateVoiceRerun: {
        resultId: "voice-append-running",
        blob: new Blob(["voice"], { type: "audio/webm" }),
        sourceMode: "append",
        composerText: "Draft",
        cursorContext: { before: "Draft", after: "" },
        status: "running",
      },
      vscodeSelectionLabel: null,
      vscodeSelectionSummary: null,
      vscodeSelectionTitle: null,
    });

    expect(screen.getByText("Rerunning as voice edit...")).toBeTruthy();
    expect(screen.queryByText("Voice append result ready")).toBeNull();
    expect(screen.getByRole("button", { name: "Rerun as voice edit" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("ComposerStatusBlocks VS Code selection chip", () => {
  it("keeps the chip label compact while showing the full path on hover", async () => {
    // Regression coverage for long paths: the visible label should be the basename/range
    // and the full absolute path should live in the popover, not in the chip body.
    mockAbsolutePath = "/test/project-b/users/jiayi/really/long/path/to/OverflowTarget.tsx";
    renderStatusBlocks({
      vscodeSelectionLabel: "OverflowTarget.tsx:7-9",
      vscodeSelectionSummary: "3 lines selected",
    });

    expect(screen.getByText("OverflowTarget.tsx:7-9")).toBeTruthy();
    expect(screen.queryByText(mockAbsolutePath)).toBeNull();

    await userEvent.hover(screen.getByTestId("vscode-selection-path-trigger"));

    expect(screen.getByTestId("vscode-selection-path-popover").textContent).toContain(mockAbsolutePath);
  });

  it("opens the full path on tap and keeps the dismiss button reachable", async () => {
    // Mobile taps should use the same popover content while the clear affordance remains
    // a separate shrink-0 control so long filenames cannot push it off screen.
    const props = renderStatusBlocks();

    await userEvent.click(screen.getByTestId("vscode-selection-path-trigger"));

    expect(screen.getByTestId("vscode-selection-path-popover").textContent).toContain(mockAbsolutePath);
    expect(screen.getByTestId("vscode-selection-dismiss").className).toContain("shrink-0");

    await userEvent.click(screen.getByTestId("vscode-selection-dismiss"));
    expect(props.onDismissVsCodeSelection).toHaveBeenCalledTimes(1);
  });
});
