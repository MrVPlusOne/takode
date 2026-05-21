import { NeedsInputRecordingStatus, NeedsInputTranscriptionFailureStatus } from "../NeedsInputAnswerField.js";

const PLAYGROUND_NEEDS_INPUT_RECORDING_HISTORY = [
  { time: 1, level: 0.1 },
  { time: 2, level: 0.28 },
  { time: 3, level: 0.66 },
  { time: 4, level: 0.86 },
  { time: 5, level: 0.38 },
  { time: 6, level: 0.72 },
];

export function PlaygroundNeedsInputRecordingPreview() {
  return (
    <div className="rounded-lg border border-cc-attention-border/70 bg-cc-attention-bg/45 p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-cc-attention">
        <span className="h-2 w-2 rounded-full border border-current" />
        <span className="min-w-0 truncate">Approve the rollout?</span>
      </div>
      <div className="flex min-w-0 items-end gap-1">
        <textarea
          readOnly
          value="Continue the rollout once the on-call confirms the final smoke check."
          rows={2}
          aria-label="Answer for Approve the rollout?"
          className="min-h-[30px] min-w-0 flex-1 resize-none rounded border border-cc-attention-border bg-cc-bg/70 px-2 py-1 text-xs text-cc-fg outline-none"
          style={{ maxHeight: 132 }}
        />
        <button
          type="button"
          aria-label="Stop voice answer"
          aria-pressed="true"
          data-recording="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cc-primary bg-cc-primary text-white ring-2 ring-cc-primary/30"
          title="Stop voice answer"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 animate-pulse">
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" />
            <path d="M3.5 7a.5.5 0 0 1 .5.5V8a4 4 0 0 0 8 0v-.5a.5.5 0 0 1 1 0V8a5 5 0 0 1-4.5 4.975V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-1.525A5 5 0 0 1 3 8v-.5a.5.5 0 0 1 .5-.5z" />
          </svg>
        </button>
      </div>
      <NeedsInputRecordingStatus volumeLevel={0.74} volumeHistory={PLAYGROUND_NEEDS_INPUT_RECORDING_HISTORY} />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="rounded border border-cc-attention-border bg-cc-attention-bg px-3 py-1 text-xs font-medium text-cc-attention"
        >
          Reply
        </button>
      </div>
    </div>
  );
}

export function PlaygroundNeedsInputTranscriptionFailurePreview() {
  return (
    <div className="rounded-lg border border-cc-attention-border/70 bg-cc-attention-bg/45 p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-cc-attention">
        <span className="h-2 w-2 rounded-full border border-current" />
        <span className="min-w-0 truncate">Approve the rollout?</span>
      </div>
      <div className="flex min-w-0 items-end gap-1">
        <textarea
          readOnly
          value="Continue after the smoke check passes."
          rows={2}
          aria-label="Answer for Approve the rollout?"
          className="min-h-[30px] min-w-0 flex-1 resize-none rounded border border-cc-attention-border bg-cc-bg/70 px-2 py-1 text-xs text-cc-fg outline-none"
          style={{ maxHeight: 132 }}
        />
        <button
          type="button"
          aria-label="Voice answer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cc-border/60 text-cc-muted"
          title="Voice answer"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" />
            <path d="M3.5 7a.5.5 0 0 1 .5.5V8a4 4 0 0 0 8 0v-.5a.5.5 0 0 1 1 0V8a5 5 0 0 1-4.5 4.975V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-1.525A5 5 0 0 1 3 8v-.5a.5.5 0 0 1 .5-.5z" />
          </svg>
        </button>
      </div>
      <NeedsInputTranscriptionFailureStatus
        message="Transcription timed out"
        onRetry={() => undefined}
        onDismiss={() => undefined}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="rounded border border-cc-attention-border bg-cc-attention-bg px-3 py-1 text-xs font-medium text-cc-attention"
        >
          Reply
        </button>
      </div>
    </div>
  );
}
