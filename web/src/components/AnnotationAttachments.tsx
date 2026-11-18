import { useState } from "react";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { useAnnotationPreview } from "./use-annotation-preview.js";
import { TranscriptionTagMarker } from "./TranscriptionTagMarker.js";
import { splitTrailingTranscriptionTag } from "../../shared/transcription-tag.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { ReportCommentTarget } from "./ReportCommentTarget.js";
export { AnnotationSourceMarkers } from "./AnnotationSourceMarkers.js";

/** Structured attachment previews; ordinary message text is never parsed as attachment syntax. */
export function AnnotationAttachments({
  annotations,
  sessionId,
  variant = "preview",
}: {
  variant?: "preview" | "message";
  sessionId?: string;
  annotations: readonly ConversationAnnotation[];
}) {
  if (!annotations.length) return null;
  return (
    <div className="flex flex-wrap gap-2 py-1" data-testid="annotation-attachments">
      {annotations.map((annotation, index) => (
        <AnnotationAttachment
          key={annotation.id}
          annotation={annotation}
          number={index + 1}
          sessionId={sessionId}
          variant={variant}
        />
      ))}
    </div>
  );
}

function AnnotationAttachment({
  annotation,
  number,
  sessionId,
  variant,
}: {
  variant: "preview" | "message";
  annotation: ConversationAnnotation;
  number: number;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(variant === "message");
  const { preview, triggerProps, close } = useAnnotationPreview(annotation, number, sessionId);
  const comment = splitTrailingTranscriptionTag(annotation.comment);
  return (
    <>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group/annotation min-w-0 max-w-full rounded-xl border border-cc-border bg-cc-hover/60 text-sm"
      >
        <summary
          {...triggerProps}
          onClick={close}
          className="cursor-pointer select-none px-3 py-2 text-cc-fg"
          aria-label={`Comment ${number}`}
        >
          Comment {number}
          {annotation.reportSource && (
            <span className="ml-2">
              <ReportCommentTarget source={annotation.reportSource} slide={annotation.slide} />
            </span>
          )}
        </summary>
        <div
          className={`max-w-lg space-y-3 border-t border-cc-border p-3 ${variant === "message" ? "" : "max-h-80 overflow-auto"}`}
        >
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-cc-primary/60 pl-3 text-cc-muted">
            {annotation.selectedText}
          </blockquote>
          <p className="whitespace-pre-wrap break-words">{comment.text}</p>
          {comment.transcribed && <TranscriptionTagMarker testId="annotation-comment-transcribed-tag" />}
          {annotation.reportSource && (
            <button
              type="button"
              className="text-xs text-cc-primary hover:underline"
              onClick={() =>
                navigateToSessionMessageId(annotation.reportSource!.sessionId, annotation.reportSource!.reportId)
              }
            >
              Open source report
            </button>
          )}
        </div>
      </details>
      {preview}
    </>
  );
}
