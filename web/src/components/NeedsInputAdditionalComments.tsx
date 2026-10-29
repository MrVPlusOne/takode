import { useState, type KeyboardEvent } from "react";
import type { SessionNotification } from "../types.js";
import { ADDITIONAL_COMMENTS_KEY, ADDITIONAL_COMMENTS_QUESTION } from "../utils/notification-questions.js";
import { NeedsInputAnswerField } from "./NeedsInputAnswerField.js";
import { IncludeCommentsCheckbox, type PendingReplyComments } from "./NeedsInputIncludeComments.js";

/**
 * Whether a reply card shows its "Additional comments" box: once the user asks for it, and whenever the
 * prompt's draft already holds such comments (typed earlier, in another browser, or by voice).
 */
export function useAdditionalComments(answers: Record<string, string>) {
  const [requested, setRequested] = useState(false);
  const value = answers[ADDITIONAL_COMMENTS_KEY] ?? "";
  return {
    value,
    shown: requested || value !== "",
    /** Whether the box appeared because the user just asked for it, so it takes focus. */
    requested,
    open: () => setRequested(true),
    /** After a reply was sent: the box closes until asked for again. */
    reset: () => setRequested(false),
  };
}

/**
 * The "Additional comments" box under its own heading, so it never reads as a second answer to the last
 * question. It has voice input like the answer boxes; its text goes after the answers.
 */
export function AdditionalCommentsField({
  sessionId,
  notification,
  questionCount,
  value,
  onChange,
  autoFocus,
  sourceContext,
  threadKey,
  threadTitle,
  onSubmit,
  headingClassName,
}: {
  sessionId: string;
  notification: SessionNotification;
  questionCount: number;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  sourceContext?: string | null;
  threadKey?: string;
  threadTitle?: string;
  onSubmit?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** The surface's question-prompt style, so the heading reads as one more entry in the list. */
  headingClassName: string;
}) {
  return (
    <div className="space-y-1.5 pt-0.5" data-testid="notification-additional-comments">
      <div className={headingClassName}>Additional comments</div>
      <NeedsInputAnswerField
        sessionId={sessionId}
        notification={notification}
        question={ADDITIONAL_COMMENTS_QUESTION}
        questionCount={questionCount}
        value={value}
        onChange={onChange}
        placeholder="Anything beyond the answers"
        ariaLabel="Additional comments"
        autoFocus={autoFocus}
        sourceContext={sourceContext}
        threadKey={threadKey}
        threadTitle={threadTitle}
        className="w-full min-w-0"
        onSubmit={onSubmit}
      />
    </div>
  );
}

/**
 * The left end of a reply card's action row: "Additional comments" (until its box is shown) and
 * "Include my N comments" (while the user has pending comments). With the checkbox it takes its own line on
 * phones, so Reply keeps its place at the right.
 */
export function NeedsInputReplyOptions({
  showAdditionalToggle,
  onAddComments,
  pendingComments,
}: {
  showAdditionalToggle: boolean;
  onAddComments: () => void;
  pendingComments: PendingReplyComments;
}) {
  if (!showAdditionalToggle && pendingComments.count === 0) return null;
  return (
    <div
      className={`mr-auto flex min-w-0 flex-wrap items-center gap-x-1 ${
        pendingComments.count > 0 ? "basis-full sm:basis-auto" : ""
      }`}
    >
      {showAdditionalToggle && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddComments();
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-[11px] font-normal cc-muted-readable transition-colors hover:text-cc-fg"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-3" aria-hidden>
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          Additional comments
        </button>
      )}
      <IncludeCommentsCheckbox
        count={pendingComments.count}
        checked={pendingComments.checked}
        onChange={pendingComments.setChecked}
      />
    </div>
  );
}
