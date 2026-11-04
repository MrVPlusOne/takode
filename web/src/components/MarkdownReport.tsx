import { stripInlineMarkdown } from "../../shared/markdown-plain-text.js";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { ArtifactMarkersContext, libraryMenuItems } from "./artifact-card-menu.js";
import { CardMoreMenu, useCardExport } from "./CardMoreMenu.js";
import { FullScreenButton, FullScreenPanel } from "./FullScreenPanel.js";
import type { ChatMessage } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { AnnotationSourceMarkers } from "./AnnotationAttachments.js";
import { exportContent, type ExportFormat } from "../utils/artifact-export.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { ReportCard } from "./ReportCard.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { ReadAloudButton, ReadAloudMessageContext, ReadAloudPlayer } from "./ReadAloudPlayer.js";
import { startReadAloud } from "../read-aloud-player.js";
import { readAloudMessageText } from "../read-aloud-text.js";
import { GuidedReviewCard } from "./GuidedReviewCard.js";
import { isSlideDeck } from "../../shared/slides.js";
import { SlideDeckCard } from "./slides/SlideDeckCard.js";

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
  if (message.metadata?.sharedDraft) return <SharedDraft message={message} readOnly={readOnly} />;
  const guidedReview = message.metadata?.guidedReview;
  if (!guidedReview && isSlideDeck(message.content))
    return <MarkdownReportDeck message={message} feedSessionId={feedSessionId} readOnly={readOnly} />;
  if (!guidedReview) return <MarkdownReportBody message={message} feedSessionId={feedSessionId} readOnly={readOnly} />;
  const source = message.metadata!.markdownReport!;
  const reviewMarker = message.metadata?.artifacts?.find((marker) => marker.kind === "review");
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
        actions={
          !readOnly ? (
            <>
              <ReportReadAloudButton message={message} sessionId={source.sessionId} />
              {reviewMarker && <CardMoreMenu items={libraryMenuItems(reviewMarker)} />}
            </>
          ) : undefined
        }
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
  // The Library's name for the report (the agent's or the user's), else its first heading or file name.
  const title = reportMarker?.title || reportTitleOf(message.content, source.sourcePath);
  const cardContentRef = useRef<HTMLDivElement>(null);
  const { exportItems, task } = useCardExport(
    useCallback(
      (format: ExportFormat) =>
        exportContent(format, { markdown: message.content, content: cardContentRef.current, title }),
      [message.content, title],
    ),
  );
  // The card opens full screen; opening it in the Library or the side column, copying and exporting are in More.
  const menuItems = [
    ...(!readOnly && reportMarker ? libraryMenuItems(reportMarker) : []),
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
      <ReportCard sessionId={feedSessionId} messageId={message.id} title={title}>
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
          {/* A long report (one with a jump list) reads in a wider column. */}
          <article
            className="mx-auto min-w-0 max-w-4xl has-[[data-section-jump-list]]:max-w-6xl"
            data-markdown-report-source={JSON.stringify(source)}
            data-testid="markdown-report-full-screen"
          >
            <ReportContent message={message} readOnly={readOnly} sectionJumpList />
          </article>
        </FullScreenPanel>
      )}
    </>
  );
}

/**
 * A draft shared from the session that wrote it (`takode artifact share`): its normal card, under a
 * line naming that session, where its links and attachments resolve. The card is that draft's
 * Library artifact, so its copy marks and versions are the same everywhere it is shown.
 */
function SharedDraft({ message, readOnly }: { message: ChatMessage; readOnly: boolean }) {
  const draft = message.metadata!.sharedDraft!;
  const source = message.metadata!.markdownReport!;
  const contentRef = useRef<HTMLDivElement>(null);
  // Its draft cards read aloud from their headers; the report itself has no other Read aloud.
  const readAloud = useMemo(
    () =>
      readOnly ? null : { sessionId: source.sessionId, messageId: message.id, historyIndex: message.historyIndex },
    [readOnly, source.sessionId, message.id, message.historyIndex],
  );
  return (
    <div ref={contentRef} className="relative min-w-0" data-testid="shared-draft">
      {!readOnly && <ReadAloudPlayer messageId={message.id} />}
      <div className="mb-1 text-xs text-cc-muted">
        Draft by{" "}
        <SessionInlineLink
          sessionId={draft.sessionId}
          sessionNum={draft.sessionNum}
          className="text-cc-primary hover:underline"
        >
          {draft.sessionNum != null ? `#${draft.sessionNum}` : "its session"}
        </SessionInlineLink>
      </div>
      <ArtifactMarkersContext.Provider value={readOnly ? undefined : message.metadata?.artifacts}>
        <ReadAloudMessageContext.Provider value={readAloud}>
          <MarkdownContent
            text={message.content}
            sessionId={draft.sessionId}
            enableChatSelectionMenu={!readOnly}
            fileLinkMode={readOnly ? "text-only" : "interactive"}
            questLinkSurface="chat-feed"
          />
        </ReadAloudMessageContext.Provider>
      </ArtifactMarkersContext.Provider>
      {!readOnly && (
        <AnnotationSourceMarkers sessionId={source.sessionId} messageId={message.id} contentRef={contentRef} />
      )}
    </div>
  );
}

/**
 * A report written as a slide deck: one slide at a time with Present and Play, in place of the long
 * card. Slides render like the report's text (file links resolve against its file, text can be
 * commented on, and so can a whole slide); its More menu holds what the report card's does, with the
 * deck's own exports. Play replaces Read aloud: it reads the deck slide by slide.
 */
function MarkdownReportDeck({
  message,
  feedSessionId,
  readOnly,
}: {
  message: ChatMessage;
  feedSessionId?: string;
  readOnly: boolean;
}) {
  const source = message.metadata!.markdownReport!;
  const reportMarker = message.metadata?.artifacts?.find((marker) => marker.kind === "report");
  const title = reportMarker?.title || reportTitleOf(message.content, source.sourcePath);
  const renderSlide = useCallback(
    (markdown: string) => (
      <MarkdownContent
        text={markdown}
        sessionId={source.responsibleWorkerId ?? source.sessionId}
        enableChatSelectionMenu={!readOnly}
        fileLinkMode={readOnly ? "text-only" : "interactive"}
        fileBasePath={source.sourcePath}
        questLinkSurface="chat-feed"
      />
    ),
    [readOnly, source.responsibleWorkerId, source.sessionId, source.sourcePath],
  );
  const deckMessage = useMemo(
    () => ({ sessionId: source.sessionId, messageId: message.id, historyIndex: message.historyIndex }),
    [source.sessionId, message.id, message.historyIndex],
  );
  const comments = useMemo(
    () => ({ sessionId: feedSessionId ?? source.sessionId, messageId: message.id, source }),
    [feedSessionId, message.id, source],
  );
  return (
    <article className="min-w-0" data-markdown-report-source={JSON.stringify(source)}>
      <SlideDeckCard
        title={title}
        markdown={message.content}
        render={renderSlide}
        message={readOnly ? undefined : deckMessage}
        comments={readOnly ? undefined : comments}
        menuItems={[
          ...(!readOnly && reportMarker ? libraryMenuItems(reportMarker) : []),
          { label: "Copy Markdown", onClick: () => void writeClipboardText(message.content).catch(console.error) },
        ]}
      />
    </article>
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
  sectionJumpList = false,
}: {
  message: ChatMessage;
  readOnly: boolean;
  className?: string;
  /** List a long report's sections before the first one. */
  sectionJumpList?: boolean;
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
        sectionJumpList={sectionJumpList}
      />
      {!readOnly && (
        <AnnotationSourceMarkers sessionId={source.sessionId} messageId={message.id} contentRef={contentRef} />
      )}
    </div>
  );
}

/** A report's title from its text: its top-level heading, else its file's name. */
function reportTitleOf(markdown: string, sourcePath: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1];
  return (heading && stripInlineMarkdown(heading)) || sourcePath.split("/").pop() || "Report";
}

/** Reports have no message menu, so their header carries Read aloud (and Stop while reading). */
function ReportReadAloudButton({ message, sessionId }: { message: ChatMessage; sessionId: string }) {
  return (
    <ReadAloudButton
      messageId={message.id}
      start={() =>
        startReadAloud({
          sessionId,
          messageId: message.id,
          text: readAloudMessageText(message),
          historyIndex: message.historyIndex,
        })
      }
    />
  );
}
