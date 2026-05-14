import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { sendToSession } from "../ws.js";
import type {
  ActiveTurnRoute,
  ChatMessage,
  PendingCodexInput,
  PendingUserUpload,
  SdkSessionInfo,
  SessionState,
} from "../types.js";
import { YarnBallDot } from "./CatIcons.js";
import { MessageBubble } from "./MessageBubble.js";
import { NotificationChip } from "./NotificationChip.js";
import { TimerChip } from "./TimerWidget.js";
import { formatElapsed, formatTokens, getFooterFeedBlockId, getPendingCodexFeedBlockId } from "./message-feed-utils.js";
import { formatReplyContentForPreview } from "../utils/reply-context.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";

export function ElapsedTimer({
  sessionId,
  latestIndicatorVisible = false,
  onJumpToLatest,
  variant = "bar",
  currentThreadKey = "main",
  onSelectThread,
  onVisibleHeightChange,
}: {
  sessionId: string;
  latestIndicatorVisible?: boolean;
  onJumpToLatest?: () => void;
  variant?: "bar" | "floating";
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  onVisibleHeightChange?: (height: number) => void;
}) {
  const streamingStartedAt = useStore((s) => s.streamingStartedAt.get(sessionId));
  const streamingOutputTokens = useStore((s) => s.streamingOutputTokens.get(sessionId));
  const streamingPausedDuration = useStore((s) => s.streamingPausedDuration.get(sessionId) ?? 0);
  const streamingPauseStartedAt = useStore((s) => s.streamingPauseStartedAt.get(sessionId));
  const sessionStatus = useStore((s) => s.sessionStatus.get(sessionId));
  const activeTurnRoute = useStore((s) => s.activeTurnRoutes?.get(sessionId));
  const bridgeIsOrchestrator = useStore((s) => s.sessions?.get(sessionId)?.isOrchestrator === true);
  const bridgeClaimedQuestId = useStore((s) => s.sessions?.get(sessionId)?.claimedQuestId ?? null);
  const sdkIsOrchestrator = useStore(
    (s) => s.sdkSessions?.find((session) => session.sessionId === sessionId)?.isOrchestrator === true,
  );
  const sdkReviewerOf = useStore(
    (s) => s.sdkSessions?.find((session) => session.sessionId === sessionId)?.reviewerOf ?? null,
  );
  const sdkClaimedQuestId = useStore(
    (s) => s.sdkSessions?.find((session) => session.sessionId === sessionId)?.claimedQuestId ?? null,
  );
  const reviewedQuestId = useStore((s) => findReviewedQuestId(sessionId, s.sdkSessions ?? [], s.sessions ?? new Map()));
  const isStuck = useStore((s) => s.sessionStuck.get(sessionId) ?? false);
  const [elapsed, setElapsed] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streamingStartedAt && sessionStatus !== "running") {
      setElapsed(0);
      return;
    }
    const start = streamingStartedAt || Date.now();
    const calcElapsed = () => {
      const pauseOffset =
        streamingPausedDuration + (streamingPauseStartedAt ? Date.now() - streamingPauseStartedAt : 0);
      return Math.max(0, Date.now() - start - pauseOffset);
    };
    setElapsed(calcElapsed());
    const interval = setInterval(() => setElapsed(calcElapsed()), 1000);
    return () => clearInterval(interval);
  }, [streamingStartedAt, sessionStatus, streamingPausedDuration, streamingPauseStartedAt]);

  const showTimer = sessionStatus === "running" && elapsed > 0;

  useLayoutEffect(() => {
    if (!onVisibleHeightChange) return;
    if (!showTimer) {
      onVisibleHeightChange(0);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const reportHeight = () => {
      onVisibleHeightChange(Math.ceil(root.getBoundingClientRect().height));
    };
    reportHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(root);
    return () => observer.disconnect();
  }, [onVisibleHeightChange, showTimer, streamingOutputTokens, variant]);

  if (!showTimer) return null;

  const handleRelaunch = () => {
    api.relaunchSession(sessionId).catch(() => {});
  };
  const isLeaderSession = bridgeIsOrchestrator || sdkIsOrchestrator;
  const activeTurnNavigationTarget = leaderActiveTurnNavigationTarget(activeTurnRoute, currentThreadKey, {
    isLeaderSession,
  });

  const label = isStuck
    ? "Session may be stuck"
    : streamingPauseStartedAt
      ? "Napping..."
      : formatActiveTurnLabel(activeTurnRoute, currentThreadKey, {
          isLeaderSession,
          isReviewerSession: sdkReviewerOf !== null,
          claimedQuestId: bridgeClaimedQuestId ?? sdkClaimedQuestId,
          reviewedQuestId,
        });
  const dotColor = isStuck
    ? "text-cc-attention"
    : streamingPauseStartedAt
      ? "text-cc-attention"
      : "text-cc-primary animate-pulse";
  const canNavigateActiveTurn =
    variant === "floating" && !!onSelectThread && !!activeTurnNavigationTarget && !isStuck && !streamingPauseStartedAt;
  const floatingChipClassName =
    "relative inline-flex max-w-[min(18rem,calc(100vw-2.75rem))] items-center gap-1.5 overflow-hidden rounded-[18px] border border-cc-border bg-cc-card/95 px-2.5 py-1 text-[11px] text-cc-muted font-mono-code shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur-md";
  const floatingChipContents = (
    <>
      <span className="pointer-events-none absolute inset-0 bg-cc-hover/20" />
      <YarnBallDot className={dotColor} />
      <span className="relative truncate text-cc-fg/90">{label}</span>
      <span className="relative text-cc-muted/75">{formatElapsed(elapsed)}</span>
      {(streamingOutputTokens ?? 0) > 0 && (
        <span className="relative hidden sm:inline truncate text-cc-muted/70">
          ↓ {formatTokens(streamingOutputTokens ?? 0)}
        </span>
      )}
      {isStuck && (
        <button
          onClick={handleRelaunch}
          className="relative ml-1 text-cc-attention hover:text-cc-attention-strong underline cursor-pointer"
        >
          Relaunch
        </button>
      )}
    </>
  );

  if (variant === "floating") {
    if (canNavigateActiveTurn && onSelectThread && activeTurnNavigationTarget) {
      const targetThreadKey = activeTurnNavigationTarget;
      return (
        <div ref={rootRef} className="pointer-events-auto">
          <button
            type="button"
            onClick={() => onSelectThread(targetThreadKey)}
            className={`${floatingChipClassName} cursor-pointer text-left transition-colors hover:border-white/14 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70`}
            data-active-turn-target={targetThreadKey}
            aria-label={`Jump to active thread ${targetThreadKey}`}
            title={`Jump to active thread ${targetThreadKey}`}
          >
            {floatingChipContents}
          </button>
        </div>
      );
    }

    return (
      <div ref={rootRef} className="pointer-events-auto">
        <div className={`${floatingChipClassName} cursor-default`} data-active-turn-target="">
          {floatingChipContents}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="shrink-0 flex items-center gap-1.5 border-t border-cc-border bg-cc-card px-3 sm:px-4 py-1.5 text-[11px] text-cc-muted font-mono-code"
    >
      <YarnBallDot className={dotColor} />
      <span>{label}</span>
      <span className="text-cc-muted/60">(</span>
      <span>{formatElapsed(elapsed)}</span>
      {(streamingOutputTokens ?? 0) > 0 && (
        <>
          <span className="text-cc-muted/40">·</span>
          <span>↓ {formatTokens(streamingOutputTokens ?? 0)}</span>
        </>
      )}
      <span className="text-cc-muted/60">)</span>
      {isStuck && (
        <button
          onClick={handleRelaunch}
          className="ml-1 text-cc-attention hover:text-cc-attention-strong underline cursor-pointer"
        >
          Relaunch
        </button>
      )}
      {latestIndicatorVisible && onJumpToLatest && (
        <button
          type="button"
          onClick={onJumpToLatest}
          className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-full border border-cc-primary/25 bg-cc-card/70 px-2.5 py-0.5 text-[11px] font-medium text-cc-fg transition-colors hover:bg-cc-hover cursor-pointer"
          title="Jump to latest"
          aria-label="Jump to latest"
        >
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-cc-primary animate-pulse" />
          <span className="truncate">New content below</span>
        </button>
      )}
    </div>
  );
}

export function FeedStatusPill({
  sessionId,
  currentThreadKey = "main",
  onVisibleHeightChange,
  onSelectThread,
}: {
  sessionId: string;
  currentThreadKey?: string;
  onVisibleHeightChange?: (height: number) => void;
  onSelectThread?: (threadKey: string) => void;
}) {
  const leftStackRef = useRef<HTMLDivElement>(null);
  const rightStackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!onVisibleHeightChange) return;
    const reportHeight = () => {
      const visibleHeight = Math.max(
        Math.ceil(leftStackRef.current?.getBoundingClientRect().height ?? 0),
        Math.ceil(rightStackRef.current?.getBoundingClientRect().height ?? 0),
      );
      onVisibleHeightChange(visibleHeight);
    };

    reportHeight();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(reportHeight);
    if (leftStackRef.current) observer.observe(leftStackRef.current);
    if (rightStackRef.current) observer.observe(rightStackRef.current);
    return () => observer.disconnect();
  }, [onVisibleHeightChange, sessionId]);

  return (
    <>
      <div
        ref={leftStackRef}
        data-testid="feed-status-pill-left"
        className="pointer-events-none absolute bottom-2 left-2 z-10 sm:bottom-3 sm:left-3"
      >
        <ElapsedTimer
          sessionId={sessionId}
          variant="floating"
          currentThreadKey={currentThreadKey}
          onSelectThread={onSelectThread}
        />
      </div>
      <div
        ref={rightStackRef}
        data-testid="feed-status-pill-right"
        className="pointer-events-none absolute bottom-2 right-2 z-10 flex flex-row items-end gap-1.5 sm:bottom-3 sm:right-3"
      >
        <TimerChip sessionId={sessionId} />
        <NotificationChip sessionId={sessionId} currentThreadKey={currentThreadKey} onSelectThread={onSelectThread} />
      </div>
    </>
  );
}

function formatActiveTurnLabel(
  activeTurnRoute: ActiveTurnRoute | null | undefined,
  currentThreadKey: string,
  context: {
    isLeaderSession: boolean;
    isReviewerSession: boolean;
    claimedQuestId?: string | null;
    reviewedQuestId?: string | null;
  },
): string {
  if (context.isLeaderSession) {
    if (!activeTurnRoute) return "Purring...";
    if (normalizeThreadKey(activeTurnRoute.threadKey) === normalizeThreadKey(currentThreadKey)) return "Active here";
    return `Active in ${activeTurnRoute.questId ?? activeTurnRoute.threadKey}`;
  }

  const activeQuestId = questIdFromRoute(activeTurnRoute);
  if (context.isReviewerSession) {
    const reviewerQuestId =
      activeQuestId ?? normalizeQuestId(context.reviewedQuestId) ?? normalizeQuestId(context.claimedQuestId);
    return reviewerQuestId ? `Reviewing ${reviewerQuestId}` : "Purring...";
  }

  const workerQuestId = activeQuestId ?? normalizeQuestId(context.claimedQuestId);
  return workerQuestId ? `Working on ${workerQuestId}` : "Purring...";
}

function leaderActiveTurnNavigationTarget(
  activeTurnRoute: ActiveTurnRoute | null | undefined,
  currentThreadKey: string,
  context: { isLeaderSession: boolean },
): string | null {
  if (!context.isLeaderSession || !activeTurnRoute?.threadKey) return null;
  const targetThreadKey = normalizeThreadKey(activeTurnRoute.threadKey);
  if (!targetThreadKey) return null;
  if (targetThreadKey === normalizeThreadKey(currentThreadKey)) return null;
  return targetThreadKey;
}

function findReviewedQuestId(
  sessionId: string,
  sdkSessions: SdkSessionInfo[],
  sessions: Map<string, SessionState>,
): string | null {
  const reviewer = sdkSessions.find((session) => session.sessionId === sessionId);
  if (reviewer?.reviewerOf === undefined) return null;

  const reviewed = sdkSessions.find((session) => session.sessionNum === reviewer.reviewerOf);
  if (!reviewed) return null;

  return (
    normalizeQuestId(reviewed.claimedQuestId) ?? normalizeQuestId(sessions.get(reviewed.sessionId)?.claimedQuestId)
  );
}

function questIdFromRoute(activeTurnRoute: ActiveTurnRoute | null | undefined): string | null {
  if (!activeTurnRoute) return null;
  return normalizeQuestId(activeTurnRoute.questId) ?? normalizeQuestId(activeTurnRoute.threadKey);
}

function normalizeQuestId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^q-\d+$/.test(trimmed) ? trimmed : null;
}

export function PendingCodexInputList({ sessionId, inputs }: { sessionId: string; inputs: PendingCodexInput[] }) {
  if (inputs.length === 0) return null;

  return (
    <div className="space-y-2" data-feed-block-id={getFooterFeedBlockId("pending-codex-inputs")}>
      <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-cc-muted/60">
        <span>Pending delivery</span>
      </div>
      <div className="flex flex-col gap-2">
        {inputs.map((input) => {
          const preview = formatReplyContentForPreview(input.content, input.replyContext).trim().replace(/\s+/g, " ");
          const truncated = preview.length > 120 ? `${preview.slice(0, 120)}...` : preview;
          return (
            <div
              key={input.id}
              data-feed-block-id={getPendingCodexFeedBlockId(input.id)}
              className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-sm text-cc-fg"
            >
              <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-cc-attention" />
              <span className="min-w-0 flex-1 truncate" title={preview || "Pending message"}>
                {truncated || "Pending message"}
              </span>
              <button
                type="button"
                disabled={!input.cancelable}
                onClick={() => {
                  sendToSession(sessionId, { type: "cancel_pending_codex_input", id: input.id });
                }}
                className={`shrink-0 rounded-full p-1 transition-colors ${
                  input.cancelable
                    ? "text-cc-muted hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
                    : "text-cc-muted/40 cursor-not-allowed"
                }`}
                title={input.cancelable ? "Cancel pending message" : "Already being delivered"}
                aria-label={input.cancelable ? "Cancel pending message" : "Pending message is already being delivered"}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PendingUserUploadList({ sessionId, uploads }: { sessionId: string; uploads: PendingUserUpload[] }) {
  if (uploads.length === 0) return null;

  return (
    <div className="space-y-2" data-feed-block-id={getFooterFeedBlockId("pending-user-uploads")}>
      <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-cc-muted/60">
        <span>Pending upload</span>
      </div>
      <div className="flex flex-col gap-3">
        {uploads.map((upload) => {
          const msg: ChatMessage = {
            id: `pending-upload-${upload.id}`,
            role: "user",
            content: upload.content,
            localImages: upload.images.map(({ name, base64, mediaType }) => ({
              name,
              base64,
              mediaType,
            })),
            timestamp: upload.timestamp,
            ...(upload.vscodeSelection || upload.replyContext || upload.threadKey || upload.questId
              ? {
                  metadata: {
                    ...(upload.replyContext ? { replyContext: upload.replyContext } : {}),
                    ...(upload.vscodeSelection ? { vscodeSelection: upload.vscodeSelection } : {}),
                    ...(upload.threadKey ? { threadKey: upload.threadKey } : {}),
                    ...(upload.questId ? { questId: upload.questId } : {}),
                  },
                }
              : {}),
            ephemeral: true,
            pendingState: upload.stage === "delivering" ? "delivering" : "failed",
            pendingError: upload.error,
            clientMsgId: upload.id,
          };

          const handleRestoreToDraft = () => {
            const store = useStore.getState();
            store.removePendingUserUpload(sessionId, upload.id);
            store.setComposerDraft(sessionId, { text: upload.content, images: upload.images });
            store.setReplyContext(sessionId, upload.replyContext ?? null);
            store.focusComposer();
          };

          const handleRetry = () => {
            if (!upload.prepared) return;
            const sent = sendToSession(sessionId, {
              type: "user_message",
              content: upload.content,
              deliveryContent: upload.prepared.deliveryContent,
              imageRefs: upload.prepared.imageRefs,
              ...(upload.replyContext ? { replyContext: upload.replyContext } : {}),
              ...(upload.vscodeSelection ? { vscodeSelection: upload.vscodeSelection } : {}),
              ...(upload.threadKey ? { threadKey: upload.threadKey } : {}),
              ...(upload.questId ? { questId: upload.questId } : {}),
              session_id: sessionId,
              client_msg_id: upload.id,
            });
            useStore
              .getState()
              .updatePendingUserUpload(sessionId, upload.id, (current) =>
                sent
                  ? { ...current, stage: "delivering", error: undefined }
                  : { ...current, stage: "failed", error: "Connection lost before delivery." },
              );
          };

          return (
            <div key={upload.id} className="space-y-1.5">
              <MessageBubble message={msg} sessionId={sessionId} showTimestamp={true} />
              <div className="flex justify-end gap-2 pr-10 text-xs">
                {upload.stage === "failed" && (
                  <>
                    {upload.prepared && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="rounded-full border border-cc-primary/30 bg-cc-card px-3 py-1 text-cc-primary transition-colors hover:bg-cc-hover cursor-pointer"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRestoreToDraft}
                      className="rounded-full border border-cc-border bg-cc-card px-3 py-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
