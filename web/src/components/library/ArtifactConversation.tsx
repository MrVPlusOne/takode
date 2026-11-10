import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ARTIFACT_KIND_LABELS, type ArtifactDetail } from "../../../shared/artifact-library.js";
import type { AnnotationArtifact } from "../../../shared/conversation-annotations.js";
import { topicApi } from "../../api/topics.js";
import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { useTextSelection } from "../../hooks/useTextSelection.js";
import { useStore } from "../../store.js";
import { rememberThreads, useArtifactThread } from "../../utils/leader-topics.js";
import { setRememberedFolded, useRememberedFold } from "../../utils/remembered-folds.js";
import { useLeaderNavigation } from "../../utils/top-bar-slots.js";
import { holdSessionConnection } from "../../ws.js";
import type { AnnotationEditorState } from "../../types.js";
import { AnnotationSourceMarkers } from "../AnnotationSourceMarkers.js";
import { resolveAnnotationRange } from "../annotation-passages.js";
import { artifactElement } from "../use-annotation-source-navigation.js";
import { Composer } from "../Composer.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { ComposerTargetContext } from "../composer-target.js";
import { SelectionContextMenu } from "../SelectionContextMenu.js";
import { SplitHandle, useSplitWidth } from "../SplitHandle.js";
import { SideConversation } from "../side-column/SideConversation.js";
import { LeaderName } from "../side-column/SideChatLeaders.js";
import { ThreadOriginName } from "../side-column/thread-names.js";
import { NewThreadIcon } from "./library-icons.js";

/**
 * The narrowest the artifact gets beside its side chat: a slide deck still shows its 16:9 stage
 * (640 pixels wide) inside the column's padding. With less room the chat goes over the artifact
 * instead of squeezing it.
 */
const ARTIFACT_MIN_WIDTH = 720;
/** Narrower than this (a phone, a narrow side column), the side chat sits under the artifact. */
const OVER_MIN_WIDTH = 900;

/** Where the side chat sits: beside the artifact, over its right side, or under it. */
type ChatPlacement = "beside" | "over" | "under";

const PLACEMENT_CLASSES: Record<ChatPlacement, string> = {
  beside: "min-h-0 w-[var(--split-w)] shrink-0 border-l border-cc-border",
  over: "absolute inset-y-0 right-0 z-10 w-[var(--split-w)] border-l border-cc-border bg-cc-bg shadow-2xl",
  under: "h-[55%] shrink-0 border-t border-cc-border",
};

/**
 * An artifact's side chat: a thread with the leader that showed it, about it, opened from the
 * artifact's view (its button, or the first comment on its text). Only a leader's artifacts have
 * one: the session the version appeared in must be a leader.
 */
export function useArtifactSideChat(detail: ArtifactDetail, version: number) {
  const source = detail.versions.find((entry) => entry.n === version)?.source ?? detail.latest.source;
  const leaderId = source.sessionId;
  const available = useLeaderNavigation(leaderId);
  // Closed until asked for, then remembered per artifact, so reopening it shows the chat again.
  const [closed, toggle] = useRememberedFold(sideChatFoldId(detail.id), true);
  return { leaderId, startedFrom: source.threadKey, available, open: available && !closed, toggle };
}

function sideChatFoldId(artifactId: string): string {
  return `artifact-side-chat:${artifactId}`;
}

/** The header button that opens and closes an artifact's side chat. */
export function ArtifactSideChatButton({ detail, version }: { detail: ArtifactDetail; version: number }) {
  const { available, open, toggle } = useArtifactSideChat(detail, version);
  if (!available) return null;
  const label = open ? "Close the side chat" : `Ask about this ${kindName(detail)}`;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-cc-hover ${open ? "text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
      data-testid="artifact-side-chat-button"
    >
      <NewThreadIcon className="h-4 w-4" />
    </button>
  );
}

/**
 * An artifact's text with its side chat. Selected text can be commented on; the comment names the
 * artifact, goes to the side chat's message box and opens the side chat. The chat is the artifact's
 * thread with its leader once a first message started it, and an empty new thread before (nothing
 * is created until then). It sits beside the artifact when both fit, else over the artifact's right
 * side, and under it on a phone or in a narrow column. `onChatWidth` hears the room the open chat
 * takes beside the artifact, so the page can grow by that much instead of narrowing the artifact.
 */
export function ArtifactConversation({
  detail,
  version,
  onChatWidth,
  children,
}: {
  detail: ArtifactDetail;
  /** The version on screen; comments name it. */
  version: number;
  /** The open side chat's width in pixels, 0 while closed. */
  onChatWidth?: (width: number) => void;
  children: ReactNode;
}) {
  const { leaderId, startedFrom, available, open, toggle } = useArtifactSideChat(detail, version);
  const threadKey = useArtifactThread(leaderId, detail.id, available);
  // The chat reads and sends over the leader's connection, whatever the main view (if any) shows.
  useEffect(() => (available ? holdSessionConnection(leaderId) : undefined), [available, leaderId]);
  const draftKey = sideComposerDraftKey(leaderId, threadKey ?? `artifact:${detail.id}`);
  // A comment started on the text opens the chat, where it is sent from. Its editor belongs to the
  // chat's message box, so it opens once that box is on screen.
  const [pendingEditor, setPendingEditor] = useState<AnnotationEditorState | null>(null);
  const comment = useCallback(
    (editor: AnnotationEditorState) => {
      if (open) {
        useStore.getState().setAnnotationEditor(editor);
        return;
      }
      setPendingEditor(editor);
      setRememberedFolded(sideChatFoldId(detail.id), false);
    },
    [open, detail.id],
  );

  const artifact = useMemo<AnnotationArtifact>(
    () => ({ id: detail.id, version, title: detail.title }),
    [detail.id, version, detail.title],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const split = useSplitWidth("artifact-side-chat", {
    defaultWidth: 440,
    min: 320,
    max: 760,
    side: "right",
    share: true,
    keepUncovered: 480,
  });
  const width = useWidth(rootRef);
  const placement: ChatPlacement =
    width - split.width >= ARTIFACT_MIN_WIDTH ? "beside" : width >= OVER_MIN_WIDTH ? "over" : "under";
  // Before paint, so the page grows with the chat (and with a drag of its divider) in one step.
  useLayoutEffect(() => {
    onChatWidth?.(open ? split.width : 0);
    return () => onChatWidth?.(0);
  }, [onChatWidth, open, split.width]);
  const kind = kindName(detail);

  const text = available ? (
    <ComposerTargetContext.Provider value={draftKey}>
      <SelectableArtifact artifact={artifact} sessionId={leaderId} onComment={comment}>
        {children}
      </SelectableArtifact>
    </ComposerTargetContext.Provider>
  ) : (
    children
  );
  const chat = open ? (
    <>
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-cc-border pl-4 pr-1 text-[13px] text-cc-muted">
        <NewThreadIcon className="h-3.5 w-3.5" />
        <span className="flex-1">Side chat about this {kind}</span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Close the side chat"
          title="Close the side chat"
          className="flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-cc-hover hover:text-cc-fg"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {pendingEditor && <OpenCommentEditor editor={pendingEditor} onOpened={() => setPendingEditor(null)} />}
        {threadKey ? (
          <SideConversation leaderId={leaderId} threadKey={threadKey} />
        ) : (
          <NewArtifactThread
            leaderId={leaderId}
            startedFrom={startedFrom}
            artifact={artifact}
            kind={kind}
            draftKey={draftKey}
          />
        )}
      </div>
    </>
  ) : null;

  // One element for every placement (React keeps them), so the width stays measured and a drag of
  // the divider goes on when the chat moves between beside and over.
  return (
    <div
      ref={rootRef}
      className={`relative flex min-h-0 flex-1 ${placement === "under" ? "flex-col" : "flex-row"}`}
      data-testid="artifact-conversation"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-6">{text}</div>
      {chat && (
        <div
          className={`flex ${PLACEMENT_CLASSES[placement]}`}
          style={placement === "under" ? undefined : split.style}
          data-testid="artifact-side-chat"
          data-placement={placement}
        >
          <SplitHandle
            label="Resize the side chat"
            className={placement === "under" ? "hidden" : "block"}
            {...split.handleProps}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Opens a comment's editor in the side chat that just opened for it. It runs as part of the chat,
 * after the chat's message box (which shows the editor) is in place.
 */
function OpenCommentEditor({ editor, onOpened }: { editor: AnnotationEditorState; onOpened: () => void }) {
  useEffect(() => {
    // Opening the chat moved the text, so the editor goes by its passage's new place.
    const root = editor.annotation.artifact ? artifactElement(editor.annotation.artifact.id) : undefined;
    const passage = root ? resolveAnnotationRange(root, editor.annotation)?.getBoundingClientRect() : undefined;
    useStore
      .getState()
      .setAnnotationEditor(passage ? { ...editor, position: { x: passage.left, y: passage.bottom + 12 } } : editor);
    onOpened();
  }, [editor, onOpened]);
  return null;
}

function kindName(detail: ArtifactDetail): string {
  return ARTIFACT_KIND_LABELS[detail.kind].replace(/s$/, "").toLowerCase();
}

/**
 * The artifact's side chat before its first message: who answers, and a message box whose first
 * send starts the thread with the leader, about this artifact and from where it was shown.
 */
function NewArtifactThread({
  leaderId,
  startedFrom,
  artifact,
  kind,
  draftKey,
}: {
  leaderId: string;
  startedFrom: string;
  artifact: AnnotationArtifact;
  kind: string;
  draftKey: string;
}) {
  const newThread = useMemo(
    () => ({
      start: async (text: string) => {
        const { thread } = await topicApi.startThread(leaderId, artifact.title, startedFrom, text.slice(0, 400), {
          id: artifact.id,
          title: artifact.title,
        });
        rememberThreads(leaderId, [thread], false);
        return thread.key;
      },
      // The thread replaces this page once the leader's threads include it.
      started: () => {},
    }),
    [leaderId, startedFrom, artifact.id, artifact.title],
  );
  return (
    <ComposerFeedLayout>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="new-artifact-thread">
        <div className="max-w-xs text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-cc-fg">
            Ask <LeaderName sessionId={leaderId} />
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-cc-muted">
            Questions and comments on this {kind} start a thread about it, from{" "}
            <ThreadOriginName leaderId={leaderId} threadKey={startedFrom} />, which stays as it is. Select text to
            comment on it.
          </p>
        </div>
      </div>
      <Composer
        sessionId={leaderId}
        threadKey={startedFrom}
        draftKey={draftKey}
        newThread={newThread}
        placeholder={`Ask about this ${kind}…`}
        secondary
      />
    </ComposerFeedLayout>
  );
}

/**
 * An artifact's text as comments see it: selecting text offers Comment, and the comment names the
 * artifact (its title, link and version) instead of a message. Passages with an unsent comment stay
 * marked, as in a conversation.
 */
function SelectableArtifact({
  artifact,
  sessionId,
  onComment,
  children,
}: {
  artifact: AnnotationArtifact;
  sessionId: string;
  onComment: (editor: AnnotationEditorState) => void;
  children: ReactNode;
}) {
  // The selection hook reads its container while rendering, so the node is kept in state.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const root = useMemo(() => ({ current: node }), [node]);
  const selection = useTextSelection(root);
  return (
    <div
      ref={setNode}
      className="relative"
      data-annotation-artifact={JSON.stringify(artifact)}
      data-message-role="assistant"
    >
      {children}
      <AnnotationSourceMarkers sessionId={sessionId} artifactId={artifact.id} contentRef={root} />
      <SelectionContextMenu
        selection={selection}
        sessionId={sessionId}
        onClose={selection.dismiss}
        allowNewThread={false}
        onComment={onComment}
      />
    </div>
  );
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
