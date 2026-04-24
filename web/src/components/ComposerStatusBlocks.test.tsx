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

function renderStatusBlocks(overrides: Partial<Parameters<typeof ComposerStatusBlocks>[0]> = {}) {
  const props: Parameters<typeof ComposerStatusBlocks>[0] = {
    isPreparing: false,
    isRecording: false,
    isTranscribing: false,
    transcriptionPhase: null,
    volumeLevel: 0,
    voiceCaptureMode: "dictation",
    voiceUnsupportedInfoOpen: false,
    voiceUnsupportedMessage: null,
    voiceError: null,
    failedTranscription: null,
    voiceEditProposal: null,
    replyContext: null,
    vscodeSelectionLabel: "Composer.tsx:12-14",
    vscodeSelectionSummary: "3 lines selected",
    vscodeSelectionTitle: "[user selection in VSCode: web/src/components/Composer.tsx lines 12-14]",
    onRetryTranscription: vi.fn(),
    onDismissVoiceError: vi.fn(),
    onAcceptVoiceEdit: vi.fn(),
    onUndoVoiceEdit: vi.fn(),
    onDismissUnsupportedInfo: vi.fn(),
    onDismissReply: vi.fn(),
    onDismissVsCodeSelection: vi.fn(),
    onSetVoiceModeEdit: vi.fn(),
    onSetVoiceModeAppend: vi.fn(),
    ...overrides,
  };

  render(<ComposerStatusBlocks {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  mockAbsolutePath = "/workspace/project/web/src/components/Composer.tsx";
  vi.clearAllMocks();
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
