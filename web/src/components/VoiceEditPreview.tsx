import type { ReactNode } from "react";
import { DiffViewer } from "./DiffViewer.js";

/**
 * A voice edit waiting for the user's decision: the spoken instruction, Undo and Accept, and the change as a diff
 * of the text before and after. Shared by the composer and the comment editor so both show a voice edit the same way.
 */
export function VoiceEditPreview({
  instructionText,
  originalText,
  editedText,
  onUndo,
  onAccept,
  disabled = false,
  expandable = true,
  children,
}: {
  instructionText: string;
  originalText: string;
  editedText: string;
  onUndo: () => void;
  onAccept: () => void;
  /** Holds Undo and Accept while other voice work for the same text runs. */
  disabled?: boolean;
  /** Offer the diff's full-size view; off inside dialogs, which it would open behind. */
  expandable?: boolean;
  /** Shown between the header and the diff, such as the offer to rerun the recording in the other mode. */
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-cc-primary/20 bg-cc-primary/5 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cc-primary">Voice edit preview</div>
          <div className="mt-1 text-[12px] text-cc-muted">
            Apply instruction: <span className="text-cc-fg">{instructionText || "(no instruction text returned)"}</span>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          <button
            type="button"
            disabled={disabled}
            onClick={onUndo}
            className="rounded-lg border border-cc-border px-3 py-1.5 text-[12px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onAccept}
            className="rounded-lg bg-cc-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cc-primary-hover transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
          >
            Accept
          </button>
        </div>
      </div>
      {children}
      <div className="mt-3">
        <DiffViewer oldText={originalText} newText={editedText} mode="compact" expandable={expandable} />
      </div>
    </div>
  );
}
