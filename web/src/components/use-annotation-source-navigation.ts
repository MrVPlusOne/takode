import { useCallback, useEffect, useRef } from "react";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { resolveSessionMessageTarget } from "../api/session-message-search.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { useStore } from "../store.js";
import type { AnnotationEditorState } from "../types.js";
import { resolveAnnotationRange } from "./annotation-passages.js";
import { editsHere } from "./annotation-editor-target.js";
import { useFeedKey } from "./secondary-feed.js";

/** How long a comment waits for its source to come into view before its editor opens anyway. */
export const SOURCE_OPEN_TIMEOUT_MS = 4000;

/** The feed (by its key; null: the main feed) a source element is shown in. */
function feedKeyOf(source: HTMLElement): string | null {
  return source.closest<HTMLElement>("[data-feed-session-id]")?.dataset.feedKey ?? null;
}

function feedSurfaces(sessionId: string, threadKey: string, feedKey: string | null): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-feed-session-id]")).filter(
    (surface) =>
      surface.dataset.feedSessionId === sessionId &&
      (!surface.dataset.feedThreadKey || surface.dataset.feedThreadKey === threadKey) &&
      (surface.dataset.feedKey ?? null) === feedKey,
  );
}

function messageIn(surface: HTMLElement, messageId: string): HTMLElement | undefined {
  return Array.from(surface.querySelectorAll<HTMLElement>("[data-message-id]")).find(
    (node) => node.dataset.messageId === messageId,
  );
}

/**
 * The message a comment is on, as shown on screen: in the given feed first (the composer's own, so
 * a side pane's chip finds the pane's copy even when the main view shows the same thread), else the
 * one place that shows it.
 */
function sourceElement(
  sessionId: string,
  messageId: string,
  threadKey: string,
  feedKey: string | null,
): HTMLElement | undefined {
  for (const surface of feedSurfaces(sessionId, threadKey, feedKey)) {
    const source = messageIn(surface, messageId);
    if (source) return source;
  }
  const matches: HTMLElement[] = [];
  const surfaces = document.querySelectorAll<HTMLElement>("[data-feed-session-id], [data-annotation-preview-session]");
  for (const surface of surfaces) {
    if ((surface.dataset.feedSessionId ?? surface.dataset.annotationPreviewSession) !== sessionId) continue;
    if (surface.dataset.feedThreadKey && surface.dataset.feedThreadKey !== threadKey) continue;
    const source = messageIn(surface, messageId);
    if (source) matches.push(source);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** The view of a Library artifact on screen, when exactly one shows it. */
export function artifactElement(artifactId: string): HTMLElement | undefined {
  const matches = Array.from(document.querySelectorAll<HTMLElement>("[data-annotation-artifact]")).filter(
    (node) => (JSON.parse(node.dataset.annotationArtifact ?? "{}") as { id?: string }).id === artifactId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function sourcePosition(source: HTMLElement, annotation: ConversationAnnotation) {
  const range = resolveAnnotationRange(source, annotation);
  const feed = source.closest<HTMLElement>("[data-feed-session-id]");
  // Real feeds have already placed and persisted the exact passage in their
  // target-scroll operation. A second scroll here would bypass that ownership.
  if (!feed) source.scrollIntoView?.({ block: "center", behavior: "instant" });
  const placed = range?.getBoundingClientRect?.() ?? source.getBoundingClientRect();
  // A comment on a whole slide quotes no passage, so there is none to miss.
  return { position: { x: placed.left, y: placed.bottom + 12 }, sourceUnavailable: !range && !annotation.slide?.whole };
}

/** Opens a comment's editor once its source is in place, beside the passage, or without one. */
function openAtSource(editor: AnnotationEditorState, threadKey: string, feedKey: string | null): void {
  const where = editor.source ?? { feedKey, threadKey };
  const source = sourceElement(editor.sessionId, editor.annotation.sourceMessageId!, where.threadKey, where.feedKey);
  useStore.getState().setAnnotationEditor({
    ...editor,
    navigateToSource: false,
    ...(source ? sourcePosition(source, editor.annotation) : { sourceUnavailable: true }),
  });
}

/**
 * Opens a composer's comment at its source: jumps the feed that shows (or will show) the commented
 * message, then positions the editor beside the passage. The editor always opens in this composer,
 * and opens anyway after a while, so a jump that never lands never leaves a hidden comment open.
 */
export function useAnnotationSourceNavigation(sessionId: string, threadKey: string, draftKey: string = sessionId) {
  const request = useRef<AbortController | null>(null);
  const feedKey = useFeedKey();
  const editor = useStore((state) => state.annotationEditor);
  const opening = editor?.navigateToSource && editsHere(editor, sessionId, draftKey, threadKey) ? editor : null;
  const scrollTarget = useStore((state) => (opening ? state.scrollToMessageId.get(sessionId) : null));
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [sessionId, threadKey],
  );
  useEffect(() => {
    if (!opening) return;
    if (!scrollTarget) {
      openAtSource(opening, threadKey, feedKey);
      return;
    }
    const timer = setTimeout(() => {
      const current = useStore.getState().annotationEditor;
      if (current === opening) openAtSource(opening, threadKey, feedKey);
    }, SOURCE_OPEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [opening, scrollTarget, threadKey, feedKey]);
  return useCallback(
    async (annotation: ConversationAnnotation) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const store = useStore.getState();
      const sourceId = annotation.sourceMessageId;
      // A comment on a Library artifact points at the artifact's view, when it is on screen.
      const source = annotation.artifact
        ? artifactElement(annotation.artifact.id)
        : sourceId
          ? sourceElement(sessionId, sourceId, threadKey, feedKey)
          : undefined;
      if (source?.closest("[data-annotation-preview-session], [data-annotation-artifact]")) {
        store.setAnnotationEditor({
          sessionId,
          draftKey,
          threadKey,
          annotation,
          ...sourcePosition(source, annotation),
        });
        return;
      }
      if (source) {
        // The feed showing it jumps: this composer's own, or the one other place showing it.
        const sourceFeed = feedKeyOf(source);
        const sourceThread = source.closest<HTMLElement>("[data-feed-session-id]")?.dataset.feedThreadKey ?? threadKey;
        store.requestScrollToMessage(sessionId, sourceId!, sourceFeed);
        store.setExpandAllInTurn(sessionId, sourceId!);
        store.setAnnotationEditor({
          sessionId,
          draftKey,
          threadKey,
          annotation,
          navigateToSource: true,
          ...(sourceFeed !== feedKey ? { source: { feedKey: sourceFeed, threadKey: sourceThread } } : {}),
        });
        return;
      }
      try {
        const target = sourceId ? await resolveSessionMessageTarget(sessionId, sourceId, controller.signal) : null;
        if (controller.signal.aborted) return;
        const current = useStore
          .getState()
          .composerDrafts.get(draftKey)
          ?.annotations?.find((item) => item.id === annotation.id);
        if (!current) return;
        annotation = current;
        if (!target) {
          store.setAnnotationEditor({ sessionId, draftKey, threadKey, annotation, sourceUnavailable: true });
          return;
        }
        // A side pane loads its own thread's message itself; anything else opens in the main view.
        if (feedKey !== null && normalizeThreadKey(target.threadKey) === normalizeThreadKey(threadKey)) {
          store.requestScrollToMessage(sessionId, target.messageId, feedKey);
          store.setExpandAllInTurn(sessionId, target.messageId);
          store.setAnnotationEditor({ sessionId, draftKey, threadKey, annotation, navigateToSource: true });
          return;
        }
        navigateToSessionMessageId(sessionId, target.messageId, {
          threadKey: target.threadKey,
          preserveMainThreadRoute: true,
        });
        // The main composer follows the main view to the source's thread; a side pane's stays put.
        store.setAnnotationEditor({
          sessionId,
          draftKey,
          threadKey: feedKey === null ? target.threadKey : threadKey,
          annotation,
          navigateToSource: true,
          ...(feedKey !== null ? { source: { feedKey: null, threadKey: target.threadKey } } : {}),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          !useStore
            .getState()
            .composerDrafts.get(draftKey)
            ?.annotations?.some((item) => item.id === annotation.id)
        )
          return;
        console.error("Failed to locate comment source:", error);
        store.setAnnotationEditor({ sessionId, draftKey, threadKey, annotation, sourceUnavailable: true });
      }
    },
    [sessionId, threadKey, draftKey, feedKey],
  );
}
