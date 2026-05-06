import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { sendToSession } from "../ws.js";
import { formatNeedsInputResponse, getNeedsInputQuestionViews } from "../utils/notification-questions.js";
import {
  resolveNotificationOwnerThreadKey,
  runAfterNotificationOwnerThreadSelected,
} from "../utils/notification-thread.js";
import { formatReplyContentForAssistant } from "../utils/reply-context.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";

/** Compact marker rendered inline for notification tool calls.
 *  When sessionId and messageId are provided, shows the checkbox affordance immediately
 *  and resolves the backing notification lazily for done-state toggles. */
export function NotificationMarker({
  category,
  summary,
  sessionId,
  messageId,
  notificationId,
  doneOverride,
  onToggleDone,
  showReplyAction = true,
  currentThreadKey,
  onSelectThread,
}: {
  category: "needs-input" | "review";
  summary?: string;
  sessionId?: string;
  messageId?: string;
  notificationId?: string;
  doneOverride?: boolean;
  onToggleDone?: () => void;
  showReplyAction?: boolean;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  const isAction = category === "needs-input";
  const label = summary || (isAction ? "Needs input" : "Ready for review");

  // Find the matching notification in the store to enable interactive controls
  const notif = useStore((s) => {
    if (!sessionId) return null;
    const notifications = s.sessionNotifications?.get(sessionId);
    if (!notifications) return null;
    if (notificationId) return notifications.find((n) => n.id === notificationId && n.category === category) ?? null;
    if (!messageId) return null;
    return notifications.find((n) => n.messageId === messageId && n.category === category) ?? null;
  });

  const canToggleDone = !!onToggleDone || (!!sessionId && (!!messageId || !!notificationId));
  const isDone = doneOverride ?? notif?.done ?? false;
  const isToggleReady = !!onToggleDone || !!notif;
  const showReplyButton = !!showReplyAction && !!notif && !!sessionId && (!isAction || !isDone);
  const questionViews = useMemo(
    () => (isAction && !isDone && notif ? getNeedsInputQuestionViews(notif) : []),
    [isAction, isDone, notif],
  );
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const canSendQuickReply =
    !!sessionId && !!notif && questionViews.length > 0 && questionViews.every((q) => answersByQuestion[q.key]?.trim());

  useEffect(() => {
    setAnswersByQuestion({});
  }, [notif?.id, isDone]);
  const toggleLabel =
    category === "review"
      ? isDone
        ? "Mark as not reviewed"
        : "Mark as reviewed"
      : isDone
        ? "Mark unhandled"
        : "Mark handled";

  const toggleDone = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (onToggleDone) {
        onToggleDone();
        return;
      }
      if (!sessionId) return;
      const liveNotif =
        notif ??
        useStore
          .getState()
          .sessionNotifications.get(sessionId)
          ?.find((n) =>
            notificationId
              ? n.id === notificationId && n.category === category
              : n.messageId === messageId && n.category === category,
          ) ??
        null;
      if (!liveNotif) return;
      api.markNotificationDone(sessionId, liveNotif.id, !liveNotif.done).catch(() => {});
    },
    [sessionId, messageId, notificationId, category, onToggleDone, notif],
  );

  const handleReply = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!sessionId) return;
      const previewText = label;
      const liveNotif =
        notif ??
        findNotification({
          sessionId,
          notificationId,
          messageId,
          category,
        });
      runAfterNotificationOwnerThreadSelected({
        notification: liveNotif,
        currentThreadKey,
        onSelectThread,
        action: () => {
          useStore.getState().setReplyContext(sessionId, {
            ...(messageId ? { messageId } : {}),
            ...(liveNotif ? { notificationId: liveNotif.id } : {}),
            previewText,
          });
          useStore.getState().focusComposer();
        },
      });
    },
    [sessionId, notificationId, messageId, label, notif, category, currentThreadKey, onSelectThread],
  );

  const handleSuggestedAnswer = useCallback(
    ({ questionKey, value }: { questionKey: string; value: string }) =>
      (e: MouseEvent) => {
        e.stopPropagation();
        setAnswersByQuestion((prev) => ({ ...prev, [questionKey]: value }));
      },
    [],
  );

  const sendQuickReply = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!sessionId || !notif || !canSendQuickReply) return;
      runAfterNotificationOwnerThreadSelected({
        notification: notif,
        currentThreadKey,
        onSelectThread,
        action: () => {
          const notificationMessageId = notif.messageId ?? messageId;
          const threadKey = resolveNotificationOwnerThreadKey(notif);
          const content = formatNeedsInputResponse(notif.summary ?? summary, questionViews, answersByQuestion);
          const replyContext = {
            ...(notificationMessageId ? { messageId: notificationMessageId } : {}),
            notificationId: notif.id,
            previewText: notif.summary || summary || "Needs your input",
          };
          const sent = sendToSession(sessionId, {
            type: "user_message",
            content,
            deliveryContent: formatReplyContentForAssistant(content, replyContext),
            replyContext,
            session_id: sessionId,
            threadKey,
            ...(threadKey !== MAIN_THREAD_KEY ? { questId: notif.questId ?? threadKey } : {}),
          });
          if (!sent) return;
          useStore.getState().requestBottomAlignOnNextUserMessage?.(sessionId);
          api.markNotificationDone(sessionId, notif.id, true).catch(() => {});
          setAnswersByQuestion({});
        },
      });
    },
    [
      answersByQuestion,
      canSendQuickReply,
      currentThreadKey,
      messageId,
      notif,
      onSelectThread,
      questionViews,
      sessionId,
      summary,
    ],
  );

  const setQuestionAnswer = useCallback((questionKey: string, value: string) => {
    setAnswersByQuestion((prev) => ({ ...prev, [questionKey]: value }));
  }, []);

  const replyButton = showReplyButton ? (
    <button
      onClick={handleReply}
      className="shrink-0 cursor-pointer rounded border border-cc-border/50 p-1 text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg"
      title="reply in composer"
      aria-label="reply in composer"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
        <path d="M6.78 1.97a.75.75 0 010 1.06L3.81 6h6.44A4.75 4.75 0 0115 10.75v1.5a.75.75 0 01-1.5 0v-1.5a3.25 3.25 0 00-3.25-3.25H3.81l2.97 2.97a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z" />
      </svg>
    </button>
  ) : null;

  return (
    <div
      className={`inline-flex max-w-full flex-col items-start gap-1 mt-2 px-2 py-0.5 rounded-xl text-[11px] font-medium border transition-opacity ${
        isDone
          ? "border-cc-border bg-cc-hover/30 text-cc-muted opacity-60"
          : isAction
            ? "border-amber-500/20 bg-amber-500/5 text-amber-400"
            : "border-emerald-500/20 bg-emerald-500/5 text-cc-muted"
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Checkbox (shown as soon as the marker has a message anchor) */}
        {canToggleDone && (
          <button
            onClick={toggleDone}
            className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            title={isToggleReady ? toggleLabel : "Waiting for notification sync"}
            aria-label={toggleLabel}
            disabled={!isToggleReady}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              {isDone ? (
                <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM0 8a8 8 0 1116 0A8 8 0 010 8zm11.354-1.646a.5.5 0 00-.708-.708L7 9.293 5.354 7.646a.5.5 0 10-.708.708l2 2a.5.5 0 00.708 0l4-4z" />
              ) : (
                <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM0 8a8 8 0 1116 0A8 8 0 010 8z" />
              )}
            </svg>
          </button>
        )}

        {/* Bell icon (used for both categories) */}
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
          <path d="M8 1.5A3.5 3.5 0 004.5 5v2.5c0 .78-.26 1.54-.73 2.16L3 10.66V11.5h10v-.84l-.77-1A3.49 3.49 0 0111.5 7.5V5A3.5 3.5 0 008 1.5zM6.5 13a1.5 1.5 0 003 0h-3z" />
        </svg>

        {/* Label */}
        <span className={`min-w-0 ${isDone ? "line-through" : ""}`}>{label}</span>

        {!isAction && replyButton}
      </div>

      {questionViews.length > 0 && (
        <div
          className="flex w-full max-w-full flex-col items-stretch gap-1 pl-5"
          data-testid="notification-answer-actions"
        >
          {questionViews.map((question, index) => (
            <div key={question.key} className="space-y-1.5" data-testid="notification-question-block">
              {questionViews.length > 1 && (
                <div className="text-[10px] leading-snug text-amber-100/80">
                  <span className="text-cc-muted">{index + 1}. </span>
                  {question.prompt}
                </div>
              )}
              {question.suggestedAnswers.map((answer) => (
                <button
                  key={answer}
                  type="button"
                  onClick={handleSuggestedAnswer({ questionKey: question.key, value: answer })}
                  className="w-full min-w-0 whitespace-normal break-words rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-1 text-left text-[10px] leading-snug text-amber-200 transition-colors hover:bg-amber-400/20 cursor-pointer"
                  title={`Use suggested answer: ${answer}`}
                  aria-label={`Use suggested answer: ${answer}`}
                >
                  {answer}
                </button>
              ))}
              <div className="flex min-w-0 items-center gap-1">
                <input
                  type="text"
                  value={answersByQuestion[question.key] ?? ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setQuestionAnswer(question.key, e.currentTarget.value)}
                  aria-label={`Answer for ${question.prompt}`}
                  className="min-w-0 flex-1 rounded border border-amber-400/25 bg-cc-bg/70 px-1.5 py-1 text-[11px] text-cc-fg outline-none transition-colors placeholder:text-cc-muted/50 focus:border-amber-400/45"
                  placeholder="Your answer"
                />
                {questionViews.length === 1 && (
                  <button
                    type="button"
                    onClick={sendQuickReply}
                    disabled={!canSendQuickReply}
                    className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                  >
                    Reply
                  </button>
                )}
                {questionViews.length === 1 && replyButton}
              </div>
            </div>
          ))}
          {questionViews.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={sendQuickReply}
                disabled={!canSendQuickReply}
                className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
              >
                Reply
              </button>
              {replyButton}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function findNotification({
  sessionId,
  notificationId,
  messageId,
  category,
}: {
  sessionId: string;
  notificationId?: string;
  messageId?: string;
  category: "needs-input" | "review";
}): SessionNotification | null {
  const notifications = useStore.getState().sessionNotifications.get(sessionId);
  if (!notifications) return null;
  if (notificationId) return notifications.find((n) => n.id === notificationId && n.category === category) ?? null;
  if (!messageId) return null;
  return notifications.find((n) => n.messageId === messageId && n.category === category) ?? null;
}
