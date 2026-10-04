import { useRef } from "react";
import type { ChatMessage } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { AnnotationSourceMarkers } from "./AnnotationAttachments.js";
import { CodeCopyButton } from "./CodeCopyButton.js";

/** A source-labelled snapshot with the ordinary chat selection scope. */
export function MarkdownReport({ message, readOnly = false }: { message: ChatMessage; readOnly?: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const source = message.metadata!.markdownReport!;
  return (
    <article className="relative min-w-0 space-y-3" data-markdown-report-source={JSON.stringify(source)}>
      <div className="group/code flex items-start gap-2 text-xs text-cc-muted">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-cc-fg">Markdown report</div>
          <div className="break-all">{source.sourcePath}</div>
          <details>
            <summary className="cursor-pointer">
              Saved snapshot · {new Date(message.timestamp).toLocaleString()}
            </summary>
            <div className="break-all">{source.sha256}</div>
          </details>
        </div>
        <CodeCopyButton text={message.content} label="Copy Markdown" />
      </div>
      <div ref={contentRef}>
        <MarkdownContent
          text={message.content}
          sessionId={source.responsibleWorkerId ?? source.sessionId}
          enableChatSelectionMenu={!readOnly}
          fileLinkMode={readOnly ? "text-only" : "interactive"}
          fileBasePath={source.sourcePath}
          questLinkSurface="chat-feed"
        />
        {!readOnly && (
          <AnnotationSourceMarkers sessionId={source.sessionId} messageId={message.id} contentRef={contentRef} />
        )}
      </div>
    </article>
  );
}
