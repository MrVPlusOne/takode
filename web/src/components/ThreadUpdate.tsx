/**
 * A thread is named by one stable title: its quest's title, else the thread's name. After it comes
 * its update, marked as one: a short line of what its newest result is about, so a glance says
 * what the user will find there (Jiayi, Nov 3: a reopened quest's round title as a second title
 * read as two similar names). The update is the thread's news line (the Scribe's, else a stand-in).
 */
import type { ReactNode } from "react";
import { TruncatedLine } from "./TruncatedLine.js";

/**
 * The mark before an update's words: a few short lines of text in the info blue, small and light
 * (Jiayi, Nov 3: B's quiet look, but not the ↳ arrow, which is the side-quest mark).
 */
export function UpdateMarker() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="h-3 w-3 shrink-0 self-center text-cc-info"
      role="img"
      aria-label="Latest"
      data-testid="thread-update-mark"
    >
      <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * An update on the title's line (a strip or a title bar), after the title. It takes only the room
 * the title leaves, and is left out whole where there is too little for the mark and a few words.
 * Place it in a flex row after the title.
 */
export function InlineThreadUpdate({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <span
      className="@container min-w-0 flex-[1_1_0%] overflow-hidden font-normal text-cc-muted"
      title={text}
      data-testid="thread-update"
    >
      <span className="hidden min-w-0 items-baseline gap-1 @[8rem]:flex">
        <UpdateMarker />
        <span className="min-w-0 truncate">{text}</span>
      </span>
    </span>
  );
}

/** An update as a row's own line: the mark, then the words cut to one line (full text on hover). */
export function ThreadUpdateLine({
  text,
  className = "",
  testId,
  lead,
}: {
  text: string;
  className?: string;
  testId?: string;
  /** Shown before the mark, such as the leader's portrait. */
  lead?: ReactNode;
}) {
  return (
    <span className={`flex min-w-0 items-baseline gap-1.5 ${className}`}>
      {lead}
      <UpdateMarker />
      <TruncatedLine text={text} className="min-w-0 flex-1" testId={testId} />
    </span>
  );
}
