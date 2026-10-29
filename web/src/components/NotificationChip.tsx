import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import type { ChatMessage, SessionNotification } from "../types.js";
import {
  isActionableSessionNotification,
  isClearedNotificationStatus,
  type NotificationStatusSnapshot,
} from "../notification-status.js";
import { attentionLedgerMessageIdForNotificationId } from "../utils/attention-records.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import {
  ADDITIONAL_COMMENTS_KEY,
  formatNeedsInputResponse,
  getNeedsInputQuestionViews,
} from "../utils/notification-questions.js";
import {
  getNotificationSourceContext,
  getNotificationTitle,
  shouldShowNeedsInputQuestionPrompt,
} from "../utils/notification-source-context.js";
import {
  resolveNotificationOwnerThreadKey,
  runAfterNotificationOwnerThreadSelected,
} from "../utils/notification-thread.js";
import { getActionableNotificationMessageId } from "../utils/notification-targets.js";
import { resultLanding } from "../utils/notification-navigation.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { NeedsInputSourceTarget } from "./NeedsInputSourceTarget.js";
import { formatSnoozeUntil } from "./NeedsInputSnoozeControl.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { canCloseThreadTab, closeThreadTab, needsInputMenuItems } from "../utils/attention-item-menu.js";
import { useSessionAttention, type SessionAttentionPreview } from "../hooks/useSessionAttention.js";
import { AttentionItemSections, attentionThreadPlace } from "./AttentionItemRows.js";
import { attentionPlaceIndex, countAttentionPlaces, type NextAttentionItem } from "../utils/next-attention.js";
import {
  ATTENTION_KIND_TITLE,
  AttentionKindIcon,
  NextChevron,
  attentionKindOf,
  attentionTone,
  formatRelativeTime,
} from "./AttentionKind.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../hooks/useLongPress.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import {
  AdditionalCommentsField,
  NeedsInputReplyOptions,
  useAdditionalComments,
} from "./NeedsInputAdditionalComments.js";
import { usePendingReplyComments } from "./NeedsInputIncludeComments.js";
import { useAttentionThreadTitles, type AttentionThreadTitles } from "../hooks/useAttentionThreadTitles.js";
import {
  NEEDS_INPUT_ACTION_ROW_CLASS,
  NeedsInputSendButton,
  NeedsInputAnswerField,
  NeedsInputSuggestedAnswers,
} from "./NeedsInputAnswerField.js";

const EMPTY: SessionNotification[] = [];
const EMPTY_MESSAGES: ChatMessage[] = [];
type NotificationCategory = SessionNotification["category"];
const NOTIFICATION_POPOVER_MIN_OFFSET_PX = 56;
const NOTIFICATION_POPOVER_ANCHOR_GAP_PX = 8;
const NOTIFICATION_POPOVER_VIEWPORT_GUTTER_PX = 12;
const OTHER_ATTENTION_KINDS = ["urgent", "reminder", "unread", "notify-me"] as const;

/** Where the chip floats: the feed's lower right (phones) or its upper right (desktop, less mouse travel). */
export type NotificationChipPlacement = "top" | "bottom";

/**
 * The inbox opens on the chip's open side: above a chip at the feed's bottom, below one at its top.
 * Returns the panel's distance from that viewport edge.
 */
function getNotificationPopoverOffsetPx(anchor: HTMLElement | null, placement: NotificationChipPlacement): number {
  if (typeof window === "undefined" || !anchor) return NOTIFICATION_POPOVER_MIN_OFFSET_PX;
  const anchorRect = anchor.getBoundingClientRect();
  if (anchorRect.top === 0 && anchorRect.bottom === 0 && anchorRect.width === 0 && anchorRect.height === 0) {
    return NOTIFICATION_POPOVER_MIN_OFFSET_PX;
  }
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const edgeDistance = placement === "top" ? anchorRect.bottom : viewportHeight - anchorRect.top;
  if (!Number.isFinite(edgeDistance) || viewportHeight <= 0) return NOTIFICATION_POPOVER_MIN_OFFSET_PX;
  return Math.max(NOTIFICATION_POPOVER_MIN_OFFSET_PX, Math.ceil(edgeDistance + NOTIFICATION_POPOVER_ANCHOR_GAP_PX));
}

function useNotificationPopoverLayout(anchor: HTMLElement | null, placement: NotificationChipPlacement) {
  const [offsetPx, setOffsetPx] = useState(NOTIFICATION_POPOVER_MIN_OFFSET_PX);

  useLayoutEffect(() => {
    const update = () => setOffsetPx(getNotificationPopoverOffsetPx(anchor, placement));
    update();

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && anchor) {
      observer = new ResizeObserver(update);
      observer.observe(anchor);
    }

    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [anchor, placement]);

  return {
    [placement === "top" ? "--notification-popover-top" : "--notification-popover-bottom"]: `${offsetPx}px`,
    "--notification-popover-available-height": `calc(100dvh - ${offsetPx}px - ${NOTIFICATION_POPOVER_VIEWPORT_GUTTER_PX}px)`,
  } as CSSProperties;
}

/** The popover's left edge under the anchor's left edge, kept inside the window; null without an anchor. */
function usePopoverLeftUnderAnchor(anchor: HTMLElement | null, popoverRef: RefObject<HTMLDivElement | null>) {
  const [leftPx, setLeftPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!anchor || !popover) {
      setLeftPx(null);
      return;
    }
    const update = () => {
      const maxLeft = window.innerWidth - popover.offsetWidth - NOTIFICATION_POPOVER_VIEWPORT_GUTTER_PX;
      const left = Math.min(anchor.getBoundingClientRect().left, maxLeft);
      setLeftPx(Math.max(NOTIFICATION_POPOVER_VIEWPORT_GUTTER_PX, left));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor, popoverRef]);
  return leftPx;
}

function useNotifications(sessionId: string) {
  const all = useStore((s) => s.sessionNotifications?.get(sessionId)) ?? EMPTY;
  const actionable = useMemo(() => all.filter(isActionableSessionNotification), [all]);
  const needsInput = useMemo(() => actionable.filter((n) => n.category === "needs-input"), [actionable]);
  const active = useMemo(() => needsInput.filter((n) => !n.done && !n.muted), [needsInput]);
  const muted = useMemo(() => needsInput.filter((n) => !n.done && n.muted), [needsInput]);
  const done = useMemo(() => needsInput.filter((n) => n.done), [needsInput]);
  return { all: needsInput, active, muted, done };
}

function useNotificationSummary(sessionId: string): NotificationStatusSnapshot {
  const notificationUrgency = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationUrgency,
  );
  const activeNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeNotificationCount,
  );
  const activeNeedsInputNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeNeedsInputNotificationCount,
  );
  const activeReviewNotificationCount = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.activeReviewNotificationCount,
  );
  const notificationStatusVersion = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationStatusVersion,
  );
  const notificationStatusUpdatedAt = useStore(
    (s) => s.sdkSessions.find((entry) => entry.sessionId === sessionId)?.notificationStatusUpdatedAt,
  );
  return useMemo(
    () => ({
      notificationUrgency,
      activeNotificationCount,
      activeNeedsInputNotificationCount,
      activeReviewNotificationCount,
      notificationStatusVersion,
      notificationStatusUpdatedAt,
    }),
    [
      notificationUrgency,
      activeNotificationCount,
      activeNeedsInputNotificationCount,
      activeReviewNotificationCount,
      notificationStatusVersion,
      notificationStatusUpdatedAt,
    ],
  );
}

function getNotificationBreakdown(notifications: ReadonlyArray<Pick<SessionNotification, "category" | "muted">>) {
  let needsInput = 0;
  let review = 0;
  for (const notification of notifications) {
    if (notification.category === "needs-input" && notification.muted) continue;
    if (notification.category === "needs-input") needsInput += 1;
    else if (notification.category === "review") review += 1;
  }
  return { needsInput, review, waiting: 0 };
}

function getSummaryBreakdown(summary: NotificationStatusSnapshot) {
  const count = summary.activeNeedsInputNotificationCount ?? summary.activeNotificationCount ?? 0;
  if (count <= 0) return { needsInput: 0, review: 0, waiting: 0 };
  if (summary.notificationUrgency === "needs-input") return { needsInput: count, review: 0, waiting: 0 };
  return { needsInput: 0, review: 0, waiting: 0 };
}

function getEffectiveNotificationBreakdown(
  notifications: ReadonlyArray<Pick<SessionNotification, "category" | "muted">>,
  summary: NotificationStatusSnapshot,
) {
  if (isClearedNotificationStatus(summary)) return { needsInput: 0, review: 0, waiting: 0 };
  const live = getNotificationBreakdown(notifications);
  const liveTotal = live.needsInput + live.review + live.waiting;
  const summaryCount = summary.activeNotificationCount ?? 0;
  const summaryNeedsInputCount = summary.activeNeedsInputNotificationCount;
  const hasFreshSummary =
    summary.notificationStatusVersion !== undefined || summary.notificationStatusUpdatedAt !== undefined;
  const summaryUrgency = summary.notificationUrgency;
  if (hasFreshSummary && summaryNeedsInputCount !== undefined && summaryNeedsInputCount !== live.needsInput) {
    return { needsInput: summaryNeedsInputCount, review: 0, waiting: 0 };
  }
  if (hasFreshSummary && summaryCount > 0 && summaryUrgency) {
    const liveDisagreesWithSummary =
      liveTotal !== summaryCount ||
      (summaryUrgency === "needs-input" && live.needsInput === 0) ||
      (summaryUrgency === "review" && live.needsInput > 0);
    if (liveDisagreesWithSummary) return getSummaryBreakdown(summary);
  }
  if (hasFreshSummary && summaryCount > 0 && summaryUrgency === null && liveTotal !== summaryCount) {
    return getSummaryBreakdown(summary);
  }
  return live;
}

function formatChipAriaLabel({
  needsInput,
  review,
  waiting,
  mutedNeedsInput,
}: {
  needsInput: number;
  review: number;
  waiting: number;
  mutedNeedsInput: number;
}): string {
  const parts: string[] = [];
  if (needsInput > 0)
    parts.push(`${needsInput} ${needsInput === 1 ? "needs-input notification" : "needs-input notifications"}`);
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? "waiting status" : "waiting statuses"}`);
  if (mutedNeedsInput > 0) {
    parts.push(`${mutedNeedsInput} muted needs-input ${mutedNeedsInput === 1 ? "notification" : "notifications"}`);
  }
  return parts.length > 0 ? `Notification inbox: ${parts.join(", ")}` : "Notification inbox: no active notifications";
}

function NotificationCountInline({
  category,
  count,
  labelText,
  tone = "active",
}: {
  category: NotificationCategory;
  count: number;
  labelText: string;
  tone?: "active" | "muted";
}) {
  const isNeedsInput = category === "needs-input";
  const isReview = category === "review";
  const mutedTone = tone === "muted";
  const iconClassName = mutedTone
    ? "text-cc-muted"
    : isNeedsInput
      ? "text-cc-attention"
      : isReview
        ? "text-cc-info"
        : "text-cc-muted/85";
  const label = isNeedsInput ? "Needs input" : isReview ? "Review" : "Waiting";

  return (
    <span
      data-testid={`notification-chip-${category}`}
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-hidden="true"
      title={`${label}: ${count}`}
    >
      <span className="text-cc-fg/95">{count}</span>
      <svg
        className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {category === "waiting" ? (
          <>
            <path d="M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5z" />
            <path d="M8 5.25V8l1.75 1.1" />
          </>
        ) : (
          <>
            <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 8 1.5z" />
            <path d="M6 12a2 2 0 0 0 4 0" />
          </>
        )}
      </svg>
      {labelText && (
        <span
          className={
            mutedTone
              ? "text-cc-muted"
              : isNeedsInput
                ? "text-cc-attention"
                : isReview
                  ? "text-cc-info"
                  : "text-cc-muted/85"
          }
        >
          {labelText}
        </span>
      )}
    </span>
  );
}

function parseSingleQuestSummary(summary?: string): { before: string; questId: string; after: string } | null {
  if (!summary) return null;
  const matches = Array.from(summary.matchAll(/\b(q-\d+)\b/gi));
  if (matches.length !== 1 || matches[0].index == null) return null;
  const questId = matches[0][1];
  const start = matches[0].index;
  const end = start + matches[0][0].length;
  return {
    before: summary.slice(0, start),
    questId,
    after: summary.slice(end),
  };
}

function getCompactReviewSummary(
  summary?: string,
): { text: string; questSummary: { before: string; questId: string; after: string } | null } | null {
  if (!summary) return null;

  const singleQuestMatch = summary.match(/^\s*(q-\d+)\s+ready\s+for\s+review(?:\s*:\s*(.+?))?\s*$/i);
  if (singleQuestMatch) {
    const questId = singleQuestMatch[1];
    const title = singleQuestMatch[2]?.trim();
    return {
      text: title ? `${questId}: ${title}` : questId,
      questSummary: {
        before: "",
        questId,
        after: title ? `: ${title}` : "",
      },
    };
  }

  const multiQuestMatch = summary.match(/^\s*\d+\s+quests?\s+ready\s+for\s+review\s*:\s*(.+?)\s*$/i);
  if (multiQuestMatch) {
    return {
      text: multiQuestMatch[1].trim(),
      questSummary: null,
    };
  }

  return { text: summary, questSummary: parseSingleQuestSummary(summary) };
}

// ─── Notification Item ───────────────────────────────────────────────────────

function NotificationItem({
  notif,
  sessionId,
  currentThreadKey,
  onSelectThread,
  threads,
}: {
  notif: SessionNotification;
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  /** Thread tab lookups for the second line of prompts. */
  threads?: AttentionThreadTitles;
}) {
  const toggle = usePendingAction("Update failed.");
  const response = usePendingAction("Response could not be delivered.");
  const pendingComments = usePendingReplyComments(notif.category === "needs-input" ? sessionId : undefined);
  const toggleDone = useCallback(() => {
    void toggle.run(() => api.markNotificationDone(sessionId, notif.id, !notif.done));
  }, [sessionId, notif.id, notif.done, toggle.run]);

  const ownerThreadKey = resolveNotificationOwnerThreadKey(notif);
  // Prompts name the thread tab they belong to on the second line, as the attention lists do.
  const ownerPlace =
    notif.category === "needs-input"
      ? attentionThreadPlace(
          {
            kind: "needs-input",
            entry: { sessionId, sessionName: "", sessionNum: null, notification: notif },
            key: notif.id,
            sessionId,
            threadKey: ownerThreadKey,
            label: "",
            timestamp: notif.timestamp,
          },
          threads,
        )
      : null;
  const messages = useStore((s) => s.messages?.get(sessionId) ?? EMPTY_MESSAGES);
  const threadWindowMessages = useStore((s) => s.threadWindowMessages?.get(sessionId));
  const notificationTargetMessages = useMemo(() => {
    const ownerWindowMessages = threadWindowMessages?.get(ownerThreadKey) ?? EMPTY_MESSAGES;
    const selectedThreadKey = normalizeThreadKey(currentThreadKey ?? MAIN_THREAD_KEY);
    const selectedWindowMessages =
      selectedThreadKey !== ownerThreadKey
        ? (threadWindowMessages?.get(selectedThreadKey) ?? EMPTY_MESSAGES)
        : EMPTY_MESSAGES;
    if (ownerWindowMessages.length === 0 && selectedWindowMessages.length === 0) return messages;
    return [...messages, ...ownerWindowMessages, ...selectedWindowMessages];
  }, [currentThreadKey, messages, ownerThreadKey, threadWindowMessages]);
  const actionableMessageId = getActionableNotificationMessageId(notif, notificationTargetMessages);
  const fallbackChipMessageId =
    notif.category === "needs-input" && !actionableMessageId && ownerThreadKey !== MAIN_THREAD_KEY
      ? attentionLedgerMessageIdForNotificationId(notif.id)
      : null;
  const jumpTargetMessageId = actionableMessageId ?? fallbackChipMessageId;

  const jumpToMessage = useCallback(() => {
    if (!jumpTargetMessageId) return;
    runAfterNotificationOwnerThreadSelected({
      notification: notif,
      currentThreadKey,
      onSelectThread,
      action: () => {
        const store = useStore.getState();
        store.requestScrollToMessage(sessionId, jumpTargetMessageId);
        const landing = resultLanding(notif);
        if (landing) store.setScrollToMessageLanding(sessionId, jumpTargetMessageId, landing);
        store.setExpandAllInTurn(sessionId, jumpTargetMessageId);
      },
    });
    // Don't close panel -- user may want to click multiple notifications
  }, [sessionId, notif, currentThreadKey, onSelectThread, jumpTargetMessageId]);

  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const questionViews = useMemo(
    () => (notif.category === "needs-input" ? getNeedsInputQuestionViews(notif) : []),
    [notif],
  );
  const setQuestionAnswer = useCallback((key: string, value: string) => {
    setAnswersByQuestion((prev) => ({ ...prev, [key]: value }));
  }, []);
  const additional = useAdditionalComments(answersByQuestion);
  const startReply = useCallback(
    (answerText?: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      runAfterNotificationOwnerThreadSelected({
        notification: notif,
        currentThreadKey,
        onSelectThread,
        action: () => {
          const store = useStore.getState();
          const current = store.composerDrafts.get(sessionId);
          store.setReplyContext(sessionId, {
            ...(notif.messageId ? { messageId: notif.messageId } : {}),
            notificationId: notif.id,
            previewText: notif.summary || "Needs your input",
          });
          if (answerText !== undefined) {
            store.setComposerDraft(sessionId, { ...current, text: answerText, images: current?.images ?? [] });
          }
          store.focusComposer();
        },
      });
    },
    [sessionId, notif, currentThreadKey, onSelectThread],
  );

  const isNeedsInput = notif.category === "needs-input";
  const isMutableNeedsInput = isNeedsInput && !notif.done;
  const isMutedNeedsInput = isMutableNeedsInput && Boolean(notif.muted);
  const isSnoozedNeedsInput = isMutedNeedsInput && notif.snoozedUntil !== undefined;
  // Mute, Remind me later and Cancel snooze live in the row's context menu; Go to stays inline.
  const longPress = useLongPress(
    isMutableNeedsInput
      ? (x, y) => {
          const items = needsInputMenuItems(sessionId, notif);
          if (items.length > 0) setMenu({ x, y, items });
        }
      : undefined,
  );
  const canSendResponse =
    isNeedsInput &&
    !notif.done &&
    questionViews.length > 0 &&
    questionViews.every((q) => answersByQuestion[q.key]?.trim());
  const sendResponse = useCallback(
    (e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (!canSendResponse || response.pending) return;
      runAfterNotificationOwnerThreadSelected({
        notification: notif,
        currentThreadKey,
        onSelectThread,
        action: () => {
          const ownerThreadKey = resolveNotificationOwnerThreadKey(notif);
          const threadKey = ownerThreadKey || MAIN_THREAD_KEY;
          const content = formatNeedsInputResponse(notif.summary, questionViews, answersByQuestion);
          const annotations = pendingComments.toSend;
          void response
            .run(() =>
              api.sendNeedsInputResponse(sessionId, notif.id, {
                content,
                threadKey,
                ...(threadKey !== MAIN_THREAD_KEY ? { questId: notif.questId ?? threadKey } : {}),
                ...(annotations ? { annotations } : {}),
              }),
            )
            .then((sent) => {
              if (!sent) return;
              useStore.getState().requestBottomAlignOnNextUserMessage?.(sessionId);
              setAnswersByQuestion({});
              additional.reset();
              pendingComments.retire(annotations);
            });
        },
      });
    },
    [
      additional.reset,
      answersByQuestion,
      canSendResponse,
      currentThreadKey,
      notif,
      onSelectThread,
      pendingComments.retire,
      pendingComments.toSend,
      questionViews,
      response.pending,
      response.run,
      sessionId,
    ],
  );
  const compactReviewSummary = notif.category === "review" ? getCompactReviewSummary(notif.summary) : null;
  const label = compactReviewSummary?.text || getNotificationTitle(notif);
  const questSummary = compactReviewSummary?.questSummary ?? null;
  const labelClassName = notif.done ? "text-cc-muted line-through" : "text-cc-fg/90";
  const sourceContext = useMemo(
    () => (isNeedsInput ? getNotificationSourceContext(notif, notificationTargetMessages, actionableMessageId) : null),
    [actionableMessageId, isNeedsInput, notif, notificationTargetMessages],
  );
  const voiceThreadTitle = ownerThreadKey === MAIN_THREAD_KEY ? "Main Thread" : (notif.questId ?? ownerThreadKey);

  const renderLabel = () => {
    if (!questSummary) {
      return <span className={`block max-w-full truncate ${labelClassName}`}>{label}</span>;
    }

    return (
      <span className={`block max-w-full truncate ${labelClassName}`}>
        {questSummary.before}
        <QuestInlineLink
          questId={questSummary.questId}
          stopPropagation={true}
          className={`font-mono-code hover:underline ${notif.done ? "text-cc-muted" : "text-cc-primary"}`}
        >
          {questSummary.questId}
        </QuestInlineLink>
        {questSummary.after}
      </span>
    );
  };

  const handleJumpKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    jumpToMessage();
  };

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 hover:bg-cc-hover/40 transition-colors group"
      data-testid="notification-inbox-row"
      data-notification-id={notif.id}
      data-notification-category={notif.category}
      data-muted={isMutedNeedsInput ? "true" : undefined}
    >
      {/* Checkbox */}
      <button
        onClick={toggleDone}
        className="mt-0.5 shrink-0 w-4 h-4 rounded border border-cc-border/60 flex items-center justify-center cursor-pointer hover:border-cc-primary/50 transition-colors"
        aria-label={notif.done ? "Mark as active" : "Mark as done"}
        aria-busy={toggle.pending || undefined}
      >
        {notif.done && (
          <svg
            className="w-3 h-3 text-cc-primary"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 8.5l3 3 6-6" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* The header takes the context-menu gesture; the answer fields below keep the browser's own. */}
        <div
          {...longPress.handlers}
          style={longPress.pressStyle}
          className={isMutableNeedsInput ? LONG_PRESS_TARGET_CLASS : undefined}
          data-testid="notification-row-header"
        >
          <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <span
                className={`mt-[0.35rem] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  isMutedNeedsInput
                    ? "border border-cc-muted/70 bg-cc-muted/45"
                    : isNeedsInput
                      ? "bg-cc-attention"
                      : notif.category === "review"
                        ? "bg-cc-info"
                        : "bg-cc-muted/65"
                }`}
              />
              {isNeedsInput ? (
                <div className="min-w-0 flex-1">
                  <NeedsInputSourceTarget
                    title={label}
                    sourceContext={notif.questionOnly ? null : sourceContext}
                    titleClassName={labelClassName}
                    testIdPrefix="notification"
                    sessionId={sessionId}
                  />
                </div>
              ) : jumpTargetMessageId ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={jumpToMessage}
                  onKeyDown={handleJumpKeyDown}
                  className="min-w-0 flex-1 cursor-pointer"
                >
                  <div className="text-[12px] text-left">{renderLabel()}</div>
                </div>
              ) : (
                <div className="text-[12px] text-left">{renderLabel()}</div>
              )}
            </div>
            {isMutableNeedsInput && jumpTargetMessageId && (
              <div className="flex shrink-0 flex-wrap items-center gap-1 pl-3 sm:justify-end sm:pl-0">
                {jumpTargetMessageId && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      jumpToMessage();
                    }}
                    className="inline-flex items-center rounded border border-cc-attention-border bg-cc-attention-bg px-2 py-0.5 text-[11px] font-medium text-cc-attention transition-colors hover:bg-cc-attention-bg/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-attention/45 cursor-pointer"
                    aria-label={`Go to source for ${label}`}
                  >
                    Go to
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-3 text-[10px] text-cc-muted">
            {isMutedNeedsInput && !isSnoozedNeedsInput && (
              <span className="shrink-0 rounded border border-cc-border/70 bg-cc-hover/35 px-1 py-px font-medium">
                Muted
              </span>
            )}
            {isSnoozedNeedsInput && (
              <span className="shrink-0 rounded border border-cc-border/70 bg-cc-hover/35 px-1 py-px font-medium">
                Snoozed until {formatSnoozeUntil(notif.snoozedUntil!)}
              </span>
            )}
            {ownerPlace && (
              <span className="min-w-0 truncate" data-testid="notification-thread-place">
                <span className="font-medium text-cc-fg/70">{ownerPlace.thread}</span>
                {ownerPlace.title && <span> {ownerPlace.title}</span>}
              </span>
            )}
            <span className="shrink-0 text-cc-muted">
              {ownerPlace ? "· " : ""}
              {formatRelativeTime(notif.timestamp)}
            </span>
          </div>
        </div>
        {isNeedsInput && !notif.done && (
          <div className="mt-2 space-y-2 pl-3" data-testid="notification-answer-actions">
            {questionViews.map((question, index) => (
              <div key={question.key} className="space-y-1.5" data-testid="notification-question-block">
                {shouldShowNeedsInputQuestionPrompt({
                  prompt: question.prompt,
                  title: label,
                  questionCount: questionViews.length,
                }) && (
                  <div className="text-[11px] leading-snug text-cc-fg/80">
                    {questionViews.length > 1 && <span className="text-cc-muted">{index + 1}. </span>}
                    {question.prompt}
                  </div>
                )}
                <NeedsInputSuggestedAnswers
                  answers={question.suggestedAnswers}
                  onSelect={(answer, event) => {
                    event.stopPropagation();
                    setQuestionAnswer(question.key, answer);
                  }}
                />
                <NeedsInputAnswerField
                  sessionId={sessionId}
                  notification={notif}
                  question={question}
                  questionCount={questionViews.length}
                  value={answersByQuestion[question.key] ?? ""}
                  onChange={(value) => setQuestionAnswer(question.key, value)}
                  placeholder="Answer"
                  sourceContext={sourceContext}
                  threadKey={ownerThreadKey}
                  threadTitle={voiceThreadTitle}
                  onSubmit={sendResponse}
                />
              </div>
            ))}
            {additional.shown && (
              <AdditionalCommentsField
                sessionId={sessionId}
                notification={notif}
                questionCount={questionViews.length}
                value={additional.value}
                onChange={(value) => setQuestionAnswer(ADDITIONAL_COMMENTS_KEY, value)}
                autoFocus={additional.requested}
                sourceContext={sourceContext}
                threadKey={ownerThreadKey}
                threadTitle={voiceThreadTitle}
                onSubmit={sendResponse}
                headingClassName="text-[11px] leading-snug text-cc-fg/80"
              />
            )}
            <div className={NEEDS_INPUT_ACTION_ROW_CLASS}>
              <NeedsInputReplyOptions
                showAdditionalToggle={!additional.shown}
                onAddComments={additional.open}
                pendingComments={pendingComments}
              />
              <button
                type="button"
                onClick={startReply()}
                className="rounded-md border border-cc-border/60 px-2.5 py-1 text-[11px] cc-muted-readable transition-colors hover:border-cc-primary/40 hover:text-cc-fg cursor-pointer"
              >
                Use composer
              </button>
              <NeedsInputSendButton
                label="Send Response"
                pending={response.pending}
                disabled={!canSendResponse}
                onClick={sendResponse}
              />
            </div>
          </div>
        )}
        {(response.error || toggle.error) && (
          <p className="mt-1 text-right text-[10px] leading-snug text-cc-error" role="alert">
            {response.error ?? toggle.error}
          </p>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ─── Notification Popover ────────────────────────────────────────────────────

function NotificationPopover({
  sessionId,
  onClose,
  anchor,
  placement,
  currentThreadKey,
  onSelectThread,
  attentionItems,
  nextAttentionKey,
  onOpenAttentionItem,
  alignToAnchor = false,
}: {
  sessionId: string;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement: NotificationChipPlacement;
  /** Open under the chip, from its left edge, instead of at the window's right edge. */
  alignToAnchor?: boolean;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  /** The session's queue; its Notify Me and unread items get their own sections. */
  attentionItems: readonly NextAttentionItem[];
  /** The item the chip's next tap opens, marked in the list. */
  nextAttentionKey: string | null;
  onOpenAttentionItem: (item: NextAttentionItem) => void;
}) {
  const { active, muted, done } = useNotifications(sessionId);
  const threads = useAttentionThreadTitles(attentionItems);
  const otherAttention = useMemo(() => attentionItems.filter((item) => item.kind !== "needs-input"), [attentionItems]);
  const questOverlayId = useStore((s) => s.questOverlayId);
  const [showDone, setShowDone] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverLayoutStyle = useNotificationPopoverLayout(anchor, placement);
  const leftPx = usePopoverLeftUnderAnchor(alignToAnchor ? anchor : null, popoverRef);
  const readAll = usePendingAction("Read All failed.");
  const markAllRead = useCallback(() => {
    void readAll.run(() =>
      Promise.all(active.map((notification) => api.markNotificationDone(sessionId, notification.id, true))),
    );
  }, [active, readAll.run, sessionId]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (questOverlayId) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [onClose, questOverlayId]);

  // A row's context menu is portaled elsewhere; using it must not close the
  // inbox. An open quest overlay keeps the inbox open beneath it.
  useOutsidePress([popoverRef, anchor, "[data-context-menu]"], onClose, !questOverlayId);

  return createPortal(
    <div
      ref={popoverRef}
      className={`fixed inset-x-3 ${
        placement === "top" ? "top-[var(--notification-popover-top)]" : "bottom-[var(--notification-popover-bottom)]"
      } z-50 flex max-h-[min(60vh,28rem,var(--notification-popover-available-height))] flex-col overflow-hidden rounded-2xl border border-cc-border bg-cc-card/95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:inset-x-auto sm:right-3 sm:w-[36rem] md:w-[39rem] sm:max-w-[calc(100vw-1.5rem)] sm:max-h-[min(60vh,34rem,var(--notification-popover-available-height))]`}
      style={leftPx === null ? popoverLayoutStyle : { ...popoverLayoutStyle, left: leftPx, right: "auto" }}
      role="dialog"
      aria-label="Notification inbox"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-cc-border/50 shrink-0">
        <h2 className="text-[13px] font-medium text-cc-fg">
          Notifications
          {(active.length > 0 || muted.length > 0 || otherAttention.length > 0) && (
            <span className="ml-1.5 text-[11px] text-cc-muted font-normal">
              ({active.length + otherAttention.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {active.length > 0 && (
            <button
              onClick={markAllRead}
              aria-busy={readAll.pending || undefined}
              title={readAll.error ?? undefined}
              className="text-[11px] text-cc-primary hover:text-cc-primary-hover transition-colors px-1.5 py-0.5 cursor-pointer"
            >
              Read All
            </button>
          )}
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-cc-fg transition-colors p-1 -mr-1 cursor-pointer"
            aria-label="Close"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div className="overflow-y-auto flex-1">
        {active.length === 0 && muted.length === 0 && done.length === 0 && otherAttention.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-cc-muted">No notifications</p>
        ) : (
          <>
            {active.length > 0 && (
              <div className="divide-y divide-cc-border/20">
                {[...active].reverse().map((n) => (
                  <NotificationItem
                    key={n.id}
                    notif={n}
                    sessionId={sessionId}
                    currentThreadKey={currentThreadKey}
                    onSelectThread={onSelectThread}
                    threads={threads}
                  />
                ))}
              </div>
            )}

            <AttentionItemSections
              items={otherAttention}
              kinds={OTHER_ATTENTION_KINDS}
              onOpen={onOpenAttentionItem}
              threads={threads}
              nextKey={nextAttentionKey}
            />

            {muted.length > 0 && (
              <section className="border-t border-cc-border/60" aria-label="Muted needs-input notifications">
                <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
                  <span className="text-[11px] font-medium text-cc-muted">Muted</span>
                  <span className="text-[10px] text-cc-muted/70">{muted.length}</span>
                </div>
                <div className="divide-y divide-cc-border/20">
                  {[...muted].reverse().map((n) => (
                    <NotificationItem
                      key={n.id}
                      notif={n}
                      sessionId={sessionId}
                      currentThreadKey={currentThreadKey}
                      onSelectThread={onSelectThread}
                      threads={threads}
                    />
                  ))}
                </div>
              </section>
            )}

            {done.length > 0 && (
              <div className="border-t border-cc-border/30">
                <button
                  onClick={() => setShowDone((p) => !p)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg cursor-pointer transition-colors"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${showDone ? "rotate-90" : ""}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M6 4l4 4-4 4z" />
                  </svg>
                  Done ({done.length})
                </button>
                {showDone && (
                  <div className="divide-y divide-cc-border/10 opacity-60">
                    {[...done].reverse().map((n) => (
                      <NotificationItem
                        key={n.id}
                        notif={n}
                        sessionId={sessionId}
                        currentThreadKey={currentThreadKey}
                        onSelectThread={onSelectThread}
                        threads={threads}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Notification Chip (floating pill) ───────────────────────────────────────

/**
 * Dispatched by the "Next Item in This Session" keyboard shortcut, with the session on screen
 * as `detail.sessionId`; that session's chip takes the step.
 */
export const ATTENTION_NEXT_IN_SESSION_EVENT = "takode:attention-next-in-session";

function inThread(threadKey: string) {
  return (item: NextAttentionItem) => item.threadKey !== null && normalizeThreadKey(item.threadKey) === threadKey;
}

/**
 * Floating attention chip: a one-tap "next" button for this session. Each tap
 * opens the next item that needs the user here (needs-input prompts, then
 * pending Notify Me results, then unread results), walking the whole list and
 * wrapping at the end; the label shows the next item's position and kind.
 * Long-press (phone) or right-click (desktop) opens the inbox listing them,
 * or, on a closable leader thread tab, a menu offering to close the tab and go
 * to the next item (for reviewing tabs one by one) or to show the inbox.
 * With nothing to step through (only muted prompts, or counts whose details
 * have not loaded), a tap opens the inbox instead.
 * `attentionPreview` supplies fixed Notify Me and unread data for the Playground.
 */
export function NotificationChip({
  sessionId,
  currentThreadKey,
  onSelectThread,
  attentionPreview,
  placement = "bottom",
  docked = false,
}: {
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  attentionPreview?: SessionAttentionPreview;
  /** Which feed edge the chip floats at; its list opens away from that edge. */
  placement?: NotificationChipPlacement;
  /**
   * Sits in the thread tab row rather than floating over the feed: no floating shadow, and its
   * list opens right under it.
   */
  docked?: boolean;
}) {
  const { active, muted } = useNotifications(sessionId);
  const summary = useNotificationSummary(sessionId);
  const attention = useSessionAttention(sessionId, active, attentionPreview);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const { needsInput, review, waiting } = useMemo(
    () => getEffectiveNotificationBreakdown(active, summary),
    [active, summary],
  );
  const mutedNeedsInput = muted.length;
  const { next, goNext, peekNext, open: openItem } = attention;
  // Places, as in the top bar: a topic's new answers count once while Next steps through each.
  const total = countAttentionPlaces(attention.queue);
  const place = next ? attentionPlaceIndex(attention.queue, next.item) : 0;
  const inboxLabel = useMemo(
    () => formatChipAriaLabel({ needsInput, review, waiting, mutedNeedsInput }),
    [mutedNeedsInput, needsInput, review, waiting],
  );
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Items in the closed tab are skipped: the user is done reviewing it. The
  // view moves straight to the next item's thread instead of passing through
  // Main, then the item opens there.
  const closeTabAndGoNext = useCallback(
    (threadKey: string) => {
      const landed = peekNext(inThread(threadKey));
      closeThreadTab(sessionId, threadKey, landed?.item.threadKey ?? undefined);
      if (landed) openItem(landed.item);
    },
    [openItem, peekNext, sessionId],
  );
  const longPress = useLongPress((x, y) => {
    const threadKey = currentThreadKey ? normalizeThreadKey(currentThreadKey) : null;
    if (!threadKey || !canCloseThreadTab(sessionId, threadKey)) {
      setOpen(true);
      return;
    }
    const closeLabel = peekNext(inThread(threadKey)) ? "Close tab and go to next" : "Close tab";
    setOpen(false);
    setMenu({
      x,
      y,
      items: [
        { label: closeLabel, onClick: () => closeTabAndGoNext(threadKey) },
        { label: "Show list", onClick: () => setOpen(true) },
      ],
    });
  });

  const close = useCallback(() => setOpen(false), []);
  const activate = useCallback(() => {
    if (!next) {
      setOpen((p) => !p);
      return;
    }
    setOpen(false);
    goNext();
  }, [goNext, next]);

  // The shortcut steps like a tap, but with nothing to step through it does nothing:
  // opening the list from the keyboard would only cover the feed.
  useEffect(() => {
    const onShortcut = (event: Event) => {
      if ((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId !== sessionId || !next) return;
      setOpen(false);
      goNext();
    };
    window.addEventListener(ATTENTION_NEXT_IN_SESSION_EVENT, onShortcut);
    return () => window.removeEventListener(ATTENTION_NEXT_IN_SESSION_EVENT, onShortcut);
  }, [goNext, next, sessionId]);

  if (needsInput + waiting + total === 0 && mutedNeedsInput === 0) return null;

  const nextKind = next ? attentionKindOf(next.item) : null;
  const tone = nextKind ? attentionTone(nextKind) : null;
  return (
    <>
      <div ref={chipRef} data-testid="session-attention-chip" className="pointer-events-auto relative inline-flex">
        <button
          type="button"
          {...longPress.handlers}
          style={longPress.pressStyle}
          onClick={activate}
          aria-label={
            next
              ? `Go to the next item that needs attention in this session: ${ATTENTION_KIND_TITLE[nextKind!]}, ${place + 1} of ${total}. Right-click or long-press for the list or to close this tab.`
              : inboxLabel
          }
          title={
            next
              ? "Next item that needs attention here. Right-click or long-press for the list or to close this tab."
              : undefined
          }
          data-testid={next ? "session-attention-next" : undefined}
          className={`relative inline-flex max-w-[min(18rem,calc(100vw-2.75rem))] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[18px] border bg-cc-card/95 py-1 pl-2.5 pr-1.5 text-[11px] text-cc-muted font-mono-code ${docked ? "" : "shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur-md"} transition-colors hover:border-cc-muted/35 cursor-pointer ${LONG_PRESS_TARGET_CLASS} ${
            tone ? tone.border : "border-cc-border pr-2.5"
          }`}
        >
          <span className="pointer-events-none absolute inset-0 bg-cc-hover/20" />
          {next ? (
            <>
              <span className="relative inline-flex">
                <AttentionKindIcon kind={nextKind!} />
              </span>
              <span className="relative tabular-nums text-cc-fg/95" data-testid="session-attention-position">
                {place + 1}/{total}
              </span>
              <span className="relative text-cc-muted">·</span>
              {/* "Next" rather than the kind ("needs input" was long); the tinted icon tells the kinds apart. */}
              <span className={`relative ${tone!.text}`}>Next</span>
              <span className={`relative ${tone!.text}`}>
                <NextChevron />
              </span>
            </>
          ) : mutedNeedsInput > 0 && needsInput === 0 ? (
            <span className="relative">
              <NotificationCountInline category="needs-input" count={0} labelText="needs input" tone="muted" />
            </span>
          ) : needsInput > 0 ? (
            <span className="relative">
              <NotificationCountInline category="needs-input" count={needsInput} labelText="needs input" />
            </span>
          ) : (
            <span className="relative">
              <NotificationCountInline category="waiting" count={waiting} labelText="status" />
            </span>
          )}
        </button>
      </div>

      {open && (
        <NotificationPopover
          sessionId={sessionId}
          onClose={close}
          anchor={chipRef.current}
          placement={placement}
          currentThreadKey={currentThreadKey}
          onSelectThread={onSelectThread}
          attentionItems={attention.queue}
          nextAttentionKey={next?.item.key ?? null}
          onOpenAttentionItem={attention.open}
          alignToAnchor={docked}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}
