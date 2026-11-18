import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { splitTrailingTranscriptionTag } from "../../shared/transcription-tag.js";
import { useAnnotationPreview } from "./use-annotation-preview.js";
import { ReportCommentTarget } from "./ReportCommentTarget.js";
import { useComposerCoversFeedEdge } from "./ComposerFeedLayout.js";

const CHIP =
  "pointer-events-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-cc-border bg-cc-card px-2.5 text-xs text-cc-fg shadow-sm transition-colors hover:border-cc-primary/50 disabled:opacity-50";
// Chips that don't fit stay measurable but out of sight, at the row's start so they can't widen the page.
const UNSHOWN = "invisible absolute left-0 top-0";

/**
 * The draft's comments as small chips floating just above the message box, shown whether the box is
 * collapsed or expanded so they are hard to miss. Each chip starts with its comment's text; tapping it
 * opens the comment at its source. Comments that don't fit on the row are counted on a "+N" chip,
 * which opens a list of every comment.
 */
export function ComposerCommentChips({
  annotations,
  sessionId,
  disabled,
  onOpen,
  onRemove,
}: {
  annotations: readonly ConversationAnnotation[];
  sessionId: string;
  disabled: boolean;
  onOpen: (annotation: ConversationAnnotation) => void;
  onRemove?: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const shown = useChipsThatFit(row, annotations);
  if (!annotations.length) return null;
  return (
    <div ref={row} className="relative flex min-w-0 flex-1 gap-1.5" data-testid="composer-comment-chips">
      {annotations.map((annotation, index) => (
        <CommentChip
          key={annotation.id}
          annotation={annotation}
          number={index + 1}
          sessionId={sessionId}
          disabled={disabled}
          unshown={index >= shown}
          onOpen={onOpen}
        />
      ))}
      <MoreCommentsChip
        annotations={annotations}
        more={annotations.length - shown}
        disabled={disabled}
        onOpen={onOpen}
        onRemove={onRemove}
      />
    </div>
  );
}

/**
 * How many of `widths` (in order, `gap` apart) fit in `room`, leaving room for the "+N" chip
 * (`moreWidth`) whenever some don't.
 */
export function chipsThatFit(widths: readonly number[], moreWidth: number, gap: number, room: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= room) return widths.length;
  let used = moreWidth;
  let fit = 0;
  while (fit < widths.length && used + gap + widths[fit] <= room) used += gap + widths[fit++];
  return fit;
}

function useChipsThatFit(row: RefObject<HTMLDivElement | null>, annotations: readonly ConversationAnnotation[]) {
  const [shown, setShown] = useState(annotations.length);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      // Without layout (no width yet) every chip shows.
      if (!element.clientWidth) return setShown(annotations.length);
      const widths = [...element.querySelectorAll<HTMLElement>("[data-comment-chip]")].map((chip) => chip.offsetWidth);
      const moreWidth = element.querySelector<HTMLElement>("[data-more-comments]")?.offsetWidth ?? 0;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      setShown(chipsThatFit(widths, moreWidth, gap, element.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const chip of element.querySelectorAll("[data-comment-chip]")) observer.observe(chip);
    return () => observer.disconnect();
  }, [row, annotations]);
  return Math.min(shown, annotations.length);
}

function CommentChip({
  annotation,
  number,
  sessionId,
  disabled,
  unshown,
  onOpen,
}: {
  annotation: ConversationAnnotation;
  number: number;
  sessionId: string;
  disabled: boolean;
  unshown: boolean;
  onOpen: (annotation: ConversationAnnotation) => void;
}) {
  const { preview, triggerProps, close } = useAnnotationPreview(annotation, number, sessionId);
  useComposerCoversFeedEdge(!!preview);
  return (
    <>
      <button
        type="button"
        data-comment-chip
        disabled={disabled}
        {...triggerProps}
        aria-label={`Comment ${number}`}
        aria-hidden={unshown || undefined}
        tabIndex={unshown ? -1 : undefined}
        className={`${CHIP} max-w-[10.5rem] sm:max-w-[12.5rem] ${unshown ? UNSHOWN : ""}`}
        // A click opens the comment; it does not also expand the message box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          close();
          onOpen(annotation);
        }}
      >
        <CommentIcon />
        {annotation.reportSource && <ReportCommentTarget source={annotation.reportSource} compact />}
        <span className="text-cc-muted">{number}</span>
        <span className="min-w-0 truncate">{commentText(annotation)}</span>
      </button>
      {preview}
    </>
  );
}

/** "+N" for the comments that don't fit; it opens a list of all of them, which previews them on phones too. */
function MoreCommentsChip({
  annotations,
  more,
  disabled,
  onOpen,
  onRemove,
}: {
  annotations: readonly ConversationAnnotation[];
  more: number;
  disabled: boolean;
  onOpen: (annotation: ConversationAnnotation) => void;
  onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listed = open && more > 0;
  useComposerCoversFeedEdge(listed);
  useEffect(() => {
    if (!listed) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [listed]);
  // Not positioned itself, so the list lines up with the start of the row.
  return (
    <div ref={root}>
      <button
        type="button"
        data-more-comments
        disabled={disabled}
        aria-expanded={listed}
        aria-label={`${Math.max(more, 1)} more comment${more === 1 ? "" : "s"}`}
        aria-hidden={more <= 0 || undefined}
        tabIndex={more <= 0 ? -1 : undefined}
        className={`${CHIP} ${more <= 0 ? UNSHOWN : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        +{Math.max(more, 1)}
      </button>
      {listed && (
        <div
          role="list"
          aria-label="Comments"
          className="pointer-events-auto absolute bottom-full left-0 z-50 mb-1.5 max-h-72 w-[min(36rem,calc(100vw-1rem))] overflow-auto rounded-xl border border-cc-border bg-cc-card p-1 shadow-xl"
        >
          {annotations.map((annotation, index) => (
            <CommentListRow
              key={annotation.id}
              number={index + 1}
              annotation={annotation}
              onOpen={() => {
                setOpen(false);
                onOpen(annotation);
              }}
              onRemove={onRemove && (() => onRemove(annotation.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentListRow({
  number,
  annotation,
  onOpen,
  onRemove,
}: {
  number: number;
  annotation: ConversationAnnotation;
  onOpen: () => void;
  onRemove?: () => void;
}): ReactNode {
  return (
    <div role="listitem" className="flex items-start gap-1 rounded-lg hover:bg-cc-hover">
      <button
        type="button"
        aria-label={`Open comment ${number}`}
        className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpen}
      >
        <span className="block truncate border-l-2 border-cc-primary/60 pl-2 text-xs text-cc-muted">
          {annotation.selectedText}
        </span>
        <span className="mt-0.5 line-clamp-2 break-words text-cc-fg">
          <span className="text-cc-muted">{number}. </span>
          {annotation.reportSource && <ReportCommentTarget source={annotation.reportSource} compact />}
          {commentText(annotation)}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove comment ${number}`}
          className="mt-1 mr-1 rounded-md p-1 text-cc-muted hover:text-red-400"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function commentText(annotation: ConversationAnnotation) {
  return splitTrailingTranscriptionTag(annotation.comment).text || annotation.selectedText;
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5 shrink-0 text-cc-primary"
    >
      <path
        d="M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
        strokeLinejoin="round"
      />
      <path d="M5 6h6M5 8.5h4" strokeLinecap="round" />
    </svg>
  );
}
