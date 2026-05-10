import { useEffect, useRef, useState } from "react";
import { DiffViewer } from "./DiffViewer.js";
import { ReplyChip } from "./ReplyChip.js";
import { useStore } from "../store.js";
import type { VoiceLevelSample } from "./composer-voice-types.js";

const VOICE_HISTORY_BAR_COUNT = 40;
const VOICE_LEVEL_CLIPPING_THRESHOLD = 0.95;

export function ComposerStatusBlocks({
  isPreparing,
  isRecording,
  isTranscribing,
  transcriptionPhase,
  volumeLevel,
  volumeHistory = [],
  voiceCaptureMode,
  voiceUnsupportedInfoOpen,
  voiceUnsupportedMessage,
  voiceError,
  failedTranscription,
  voiceEditProposal,
  replyContext,
  vscodeSelectionLabel,
  vscodeSelectionSummary,
  vscodeSelectionTitle,
  onRetryTranscription,
  onDismissVoiceError,
  onAcceptVoiceEdit,
  onUndoVoiceEdit,
  onDismissUnsupportedInfo,
  onDismissReply,
  onDismissVsCodeSelection,
  onSetVoiceModeEdit,
  onSetVoiceModeAppend,
}: {
  isPreparing: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionPhase: string | null;
  volumeLevel: number;
  volumeHistory?: VoiceLevelSample[];
  voiceCaptureMode: "dictation" | "edit" | "append";
  voiceUnsupportedInfoOpen: boolean;
  voiceUnsupportedMessage: string | null;
  voiceError: string | null;
  failedTranscription: unknown;
  voiceEditProposal: { instructionText: string; originalText: string; editedText: string } | null;
  replyContext: { previewText: string } | null;
  vscodeSelectionLabel: string | null;
  vscodeSelectionSummary: string | null;
  vscodeSelectionTitle: string | null;
  onRetryTranscription: () => void;
  onDismissVoiceError: () => void;
  onAcceptVoiceEdit: () => void;
  onUndoVoiceEdit: () => void;
  onDismissUnsupportedInfo: () => void;
  onDismissReply: () => void;
  onDismissVsCodeSelection: () => void;
  onSetVoiceModeEdit: () => void;
  onSetVoiceModeAppend: () => void;
}) {
  const vscodeSelectionFullPath = useStore((state) => state.vscodeSelectionContext?.selection?.absolutePath ?? null);
  const vscodeSelectionPathRef = useRef<HTMLDivElement>(null);
  const [vscodeSelectionPathOpen, setVscodeSelectionPathOpen] = useState(false);

  useEffect(() => {
    if (!vscodeSelectionPathOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!vscodeSelectionPathRef.current?.contains(event.target as Node)) {
        setVscodeSelectionPathOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setVscodeSelectionPathOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [vscodeSelectionPathOpen]);

  return (
    <>
      {isPreparing && (
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-cc-warning">
          <span className="w-2 h-2 rounded-full bg-cc-warning animate-pulse shrink-0" />
          <span className="shrink-0">Preparing mic...</span>
        </div>
      )}
      {isRecording && (
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-cc-primary">
          {voiceCaptureMode !== "dictation" && (
            <div
              data-testid="voice-capture-mode-toggle"
              className="flex items-center gap-0.5 rounded-full bg-cc-bg-secondary p-0.5"
            >
              <button
                type="button"
                onClick={onSetVoiceModeEdit}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  voiceCaptureMode === "edit" ? "bg-cc-primary text-white" : "text-cc-muted hover:text-cc-fg"
                }`}
                title="Voice will be interpreted as editing instructions for the existing text"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onSetVoiceModeAppend}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  voiceCaptureMode === "append" ? "bg-cc-primary text-white" : "text-cc-muted hover:text-cc-fg"
                }`}
                title="Voice will be appended as additional text at the cursor position"
              >
                Append
              </button>
            </div>
          )}
          <span className="w-2 h-2 rounded-full bg-cc-primary animate-pulse shrink-0" />
          <span className="shrink-0">Recording</span>
          <VoiceLevelWaveform currentLevel={volumeLevel} samples={volumeHistory} />
        </div>
      )}
      {isTranscribing && !isRecording && (
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-cc-primary">
          <span className="w-2 h-2 rounded-full bg-cc-primary animate-pulse" />
          <span>
            {transcriptionPhase === "preparing"
              ? "Preparing transcript..."
              : transcriptionPhase === "editing"
                ? "Editing..."
                : transcriptionPhase === "appending"
                  ? "Appending..."
                  : transcriptionPhase === "enhancing"
                    ? "Enhancing..."
                    : "Transcribing..."}
          </span>
        </div>
      )}
      {voiceUnsupportedInfoOpen && voiceUnsupportedMessage && !isRecording && !isTranscribing && (
        <div className="px-4 pt-2">
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-lg border border-cc-warning/25 bg-cc-warning/10 px-3 py-2 text-[11px] text-cc-warning"
          >
            <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            <span className="flex-1">{voiceUnsupportedMessage}</span>
            <button
              type="button"
              onClick={onDismissUnsupportedInfo}
              className="shrink-0 text-cc-warning/70 hover:text-cc-warning transition-colors"
              aria-label="Dismiss voice input message"
              title="Dismiss"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {voiceError && !isRecording && !isTranscribing && (
        <div className="px-4 pt-2">
          {failedTranscription ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-lg border border-cc-warning/25 bg-cc-warning/10 px-3 py-2 text-[11px] text-cc-warning"
            >
              <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-current opacity-80" />
              <span className="flex-1 min-w-0 truncate">{voiceError}</span>
              <button
                type="button"
                onClick={onRetryTranscription}
                className="shrink-0 rounded-md bg-cc-primary px-2.5 py-1 text-[10px] font-medium text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onDismissVoiceError}
                className="shrink-0 text-cc-warning/70 hover:text-cc-warning transition-colors cursor-pointer"
                aria-label="Dismiss transcription error"
                title="Dismiss"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-cc-warning">{voiceError}</div>
          )}
        </div>
      )}
      {voiceEditProposal && !isRecording && !isTranscribing && (
        <div className="px-4 pt-2">
          <div className="rounded-xl border border-cc-primary/20 bg-cc-primary/5 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cc-primary">
                  Voice edit preview
                </div>
                <div className="mt-1 text-[12px] text-cc-muted">
                  Apply instruction:{" "}
                  <span className="text-cc-fg">
                    {voiceEditProposal.instructionText || "(no instruction text returned)"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onUndoVoiceEdit}
                  className="rounded-lg border border-cc-border px-3 py-1.5 text-[12px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={onAcceptVoiceEdit}
                  className="rounded-lg bg-cc-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
                >
                  Accept
                </button>
              </div>
            </div>
            <div className="mt-3">
              <DiffViewer
                oldText={voiceEditProposal.originalText}
                newText={voiceEditProposal.editedText}
                mode="compact"
              />
            </div>
          </div>
        </div>
      )}
      {replyContext && <ReplyChip previewText={replyContext.previewText} onDismiss={onDismissReply} />}
      {vscodeSelectionLabel && vscodeSelectionSummary && (
        <div className="mb-2 flex min-w-0 px-4 pt-2">
          <div
            data-testid="vscode-selection-chip"
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-cc-border/80 bg-cc-hover/70 px-2 py-1 text-[11px] text-cc-muted"
            title={vscodeSelectionTitle ?? undefined}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 opacity-70">
              <path d="M3.75 1.5A2.25 2.25 0 001.5 3.75v8.5A2.25 2.25 0 003.75 14.5h8.5a2.25 2.25 0 002.25-2.25v-5a.75.75 0 00-1.5 0v5A.75.75 0 0112.25 13h-8.5a.75.75 0 01-.75-.75v-8.5A.75.75 0 013.75 3h5a.75.75 0 000-1.5h-5z" />
              <path d="M9.53 1.47a.75.75 0 011.06 0l3.94 3.94a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 01-.33.2l-2.5.63a.75.75 0 01-.91-.91l.63-2.5a.75.75 0 01.2-.33l5.5-5.5z" />
            </svg>
            <div
              ref={vscodeSelectionPathRef}
              className="relative min-w-0"
              onMouseEnter={() => setVscodeSelectionPathOpen(true)}
              onMouseLeave={() => setVscodeSelectionPathOpen(false)}
            >
              <button
                type="button"
                data-testid="vscode-selection-path-trigger"
                className="block min-w-0 max-w-full truncate rounded px-0.5 text-left font-mono-code text-cc-muted hover:text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary/40 cursor-pointer"
                aria-expanded={vscodeSelectionPathOpen}
                aria-label="Show full VS Code selection path"
                onClick={() => setVscodeSelectionPathOpen(true)}
              >
                {vscodeSelectionLabel}
              </button>
              {vscodeSelectionPathOpen && vscodeSelectionFullPath && (
                <div
                  role="tooltip"
                  data-testid="vscode-selection-path-popover"
                  className="absolute left-0 bottom-full z-20 mb-2 w-max max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-cc-border bg-cc-card px-3 py-2 text-[11px] text-cc-fg shadow-lg"
                >
                  <div className="font-mono-code break-all leading-snug">{vscodeSelectionFullPath}</div>
                </div>
              )}
            </div>
            <span className="text-cc-muted/60">&middot;</span>
            <span className="shrink-0">{vscodeSelectionSummary}</span>
            <button
              type="button"
              data-testid="vscode-selection-dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-cc-border/60 cursor-pointer"
              title="Dismiss selection"
              aria-label="Dismiss VS Code selection"
              onClick={onDismissVsCodeSelection}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function VoiceLevelWaveform({ currentLevel, samples }: { currentLevel: number; samples: VoiceLevelSample[] }) {
  const visibleSamples = samples.slice(-(VOICE_HISTORY_BAR_COUNT - 1));
  const paddedSamples = [
    ...Array.from({ length: Math.max(0, VOICE_HISTORY_BAR_COUNT - 1 - visibleSamples.length) }, () => ({
      kind: "empty" as const,
      level: 0,
      key: "empty",
    })),
    ...visibleSamples.map((sample) => ({
      kind: "history" as const,
      level: clampVoiceLevel(sample.level),
      key: sample.time,
    })),
    { kind: "current" as const, level: clampVoiceLevel(currentLevel), key: "current" },
  ];

  return (
    <div
      data-testid="voice-level-waveform"
      role="img"
      aria-label="Current and recent input level"
      title="Current and recent input level"
      className="relative flex h-4 w-[72px] sm:w-[112px] shrink-0 items-center gap-[1px] overflow-hidden rounded-[3px] border border-cc-primary/20 bg-cc-primary/5 px-[2px] py-[2px]"
    >
      {paddedSamples.map((sample, index) => {
        const level = sample.level;
        const isClipping = level >= VOICE_LEVEL_CLIPPING_THRESHOLD;
        return (
          <span
            key={`${sample.key}-${index}`}
            data-current-sample={sample.kind === "current" ? "true" : undefined}
            data-clipping={isClipping ? "true" : undefined}
            data-testid="voice-level-waveform-bar"
            className="relative z-10 min-w-0 flex-1 rounded-full transition-[height,opacity] duration-75"
            style={{
              height: `${Math.max(2, Math.round(2 + level * 12))}px`,
              opacity: sample.kind === "empty" ? 0.12 : Math.max(0.28, 0.38 + level * 0.62),
              backgroundColor: isClipping ? "rgb(252 129 129)" : "rgb(174 86 48)",
            }}
          />
        );
      })}
      <span className="pointer-events-none absolute left-[2px] right-[2px] top-1/2 h-px -translate-y-1/2 bg-cc-primary/20" />
    </div>
  );
}

function clampVoiceLevel(level: number): number {
  return Math.min(1, Math.max(0, level));
}
