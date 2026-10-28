import { useCallback, useRef, useState, type RefObject } from "react";
import { libraryMenuItem } from "./ArtifactInline.js";
import { CardMoreMenu, useCardExport } from "./CardMoreMenu.js";
import { FullScreenButton, FullScreenPanel } from "./FullScreenPanel.js";
import type { ChatMessage } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { AnnotationSourceMarkers } from "./AnnotationAttachments.js";
import { exportContent, type ExportFormat } from "../utils/artifact-export.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { ReportCard } from "./ReportCard.js";
import { ReadAloudPlayer } from "./ReadAloudPlayer.js";
import { startReadAloud, stopReadAloud, useReadAloudState } from "../read-aloud-player.js";
import { GuidedReviewCard } from "./GuidedReviewCard.js";

/**
 * A source-labelled snapshot with the ordinary chat selection scope. Reports can
 * run many screens, so they always render clipped in a card, whether or not the
 * turn around them is collapsed.
 */
export function MarkdownReport({
  message,
  feedSessionId,
  readOnly = false,
}: {
  message: ChatMessage;
  /** The session whose history holds the report, which owns whether it is expanded. */
  feedSessionId?: string;
  readOnly?: boolean;
}) {
  const guidedReview = message.metadata?.guidedReview;
  if (!guidedReview) return <MarkdownReportBody message={message} feedSessionId={feedSessionId} readOnly={readOnly} />;
  const source = message.metadata!.markdownReport!;
  return (
    <>
      {!readOnly && <ReadAloudPlayer messageId={message.id} />}
      <GuidedReviewCard
        target={{
          messageId: message.id,
          sessionId: source.sessionId,
          threadKey: message.metadata?.threadKey ?? "main",
          ...(message.metadata?.questId ? { questId: message.metadata.questId } : {}),
          meta: guidedReview,
        }}
        actions={!readOnly ? <ReportReadAloudButton message={message} sessionId={source.sessionId} /> : undefined}
      />
    </>
  );
}

function MarkdownReportBody({
  message,
  feedSessionId,
  readOnly,
}: {
  message: ChatMessage;
  feedSessionId?: string;
  readOnly: boolean;
}) {
  const [fullScreen, setFullScreen] = useState(false);
  const source = message.metadata!.markdownReport!;
  const reportMarker = message.metadata?.artifacts?.find((marker) => marker.kind === "report");
  const title = reportTitleOf(message.content, source.sourcePath);
  const cardContentRef = useRef<HTMLDivElement>(null);
  const { exportItems, task } = useCardExport(
    useCallback(
      (format: ExportFormat) =>
        exportContent(format, { markdown: message.content, content: cardContentRef.current, title }),
      [message.content, title],
    ),
  );
  // The card opens full screen; opening it in the Library, copying and exporting are in More.
  const menuItems = [
    ...(!readOnly && reportMarker ? [libraryMenuItem(reportMarker)] : []),
    { label: "Copy Markdown", onClick: () => void writeClipboardText(message.content).catch(console.error) },
    exportItems(["markdown", "pdf", "png", "html"]),
  ];
  const actions = (
    <>
      {!readOnly && <ReportReadAloudButton message={message} sessionId={source.sessionId} />}
      <CardMoreMenu items={menuItems} task={task} />
    </>
  );
  return (
    <>
      {!readOnly && <ReadAloudPlayer messageId={message.id} />}
      <ReportCard sessionId={feedSessionId} messageId={message.id}>
        <article className="relative min-w-0 space-y-3" data-markdown-report-source={JSON.stringify(source)}>
          <div className="flex items-start gap-2 text-xs text-cc-muted">
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
            <FullScreenButton onClick={() => setFullScreen(true)} />
            {actions}
          </div>
          <ReportContent message={message} readOnly={readOnly} className="mr-5" contentRef={cardContentRef} />
        </article>
      </ReportCard>
      {fullScreen && (
        <FullScreenPanel
          title={title}
          actions={actions}
          selection={readOnly ? undefined : { sessionId: feedSessionId ?? source.sessionId, messageId: message.id }}
          onClose={() => setFullScreen(false)}
        >
          <article
            className="mx-auto min-w-0 max-w-4xl"
            data-markdown-report-source={JSON.stringify(source)}
            data-testid="markdown-report-full-screen"
          >
            <ReportContent message={message} readOnly={readOnly} />
          </article>
        </FullScreenPanel>
      )}
    </>
  );
}

/**
 * A report's text, as the feed shows it: file links resolve against the report's file, selected
 * text can be commented on, and comments show where they point.
 */
function ReportContent({
  message,
  readOnly,
  className = "",
  contentRef: givenRef,
}: {
  message: ChatMessage;
  readOnly: boolean;
  className?: string;
  /** Receives the element showing the report, for exports. */
  contentRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const contentRef = givenRef ?? ownRef;
  const source = message.metadata!.markdownReport!;
  return (
    <div ref={contentRef} className={`relative min-w-0 ${className}`}>
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
  );
}

/** A report's title for the full-screen view: its top-level heading, else its file's name. */
function reportTitleOf(markdown: string, sourcePath: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1];
  return heading?.replace(/[*_`]/g, "") || sourcePath.split("/").pop() || "Report";
}

/** Reports have no message menu, so their header carries Read aloud (and Stop while reading). */
function ReportReadAloudButton({ message, sessionId }: { message: ChatMessage; sessionId: string }) {
  const readAloud = useReadAloudState(message.id);
  const reading = readAloud?.status === "preparing" || readAloud?.status === "ready";
  const label = reading ? "Stop reading aloud" : "Read aloud";
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() =>
          reading
            ? stopReadAloud()
            : startReadAloud({
                sessionId,
                messageId: message.id,
                text: message.content,
                historyIndex: message.historyIndex,
              })
        }
        aria-label={label}
        title={label}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-cc-hover ${reading ? "text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
          <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" strokeLinejoin="round" />
          <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9" strokeLinecap="round" />
        </svg>
      </button>
      {readAloud?.status === "error" && (
        <button
          type="button"
          role="alert"
          onClick={stopReadAloud}
          className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
        >
          {readAloud.error}
        </button>
      )}
    </span>
  );
}
