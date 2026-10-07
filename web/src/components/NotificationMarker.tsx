import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, SyntheticEvent } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, SessionNotification } from "../types.js";
import { formatNeedsInputResponse, getNeedsInputQuestionViews } from "../utils/notification-questions.js";
import {
  isNotificationOwnerSelected,
  resolveNotificationOwnerThreadKey,
  runAfterNotificationOwnerThreadSelected,
} from "../utils/notification-thread.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import {
  getNotificationSourceContext,
  shouldShowNeedsInputQuestionPrompt,
} from "../utils/notification-source-context.js";
import { MarkdownContent } from "./MarkdownContent.js";
import {
  NEEDS_INPUT_CARD_CLASS,
  NEEDS_INPUT_SEND_BUTTON_CLASS,
  NeedsInputAnswerField,
  NeedsInputSuggestedAnswers,
} from "./NeedsInputAnswerField.js";
import { NeedsInputResponseHistory } from "./NeedsInputResponseHistory.js";

const EMPTY_MESSAGES: ChatMessage[] = [];

/** Inline notification card, retaining completed needs-input decisions for inspection.
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
  category: SessionNotification["category"];
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
  const isReview = category === "review";
  const label = summary || (isAction ? "Needs input" : isReview ? "Ready for review" : "Waiting");

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
  const showReplyButton = !!showReplyAction && !!notif && !!sessionId && (isAction ? !isDone : isReview);
  const questionViews = useMemo(() => (isAction && notif ? getNeedsInputQuestionViews(notif) : []), [isAction, notif]);
  const body = isAction ? notif?.body?.trim() : undefined;
  // Question-only cards hold no explanation, so their question reads at chat-adjacent size.
  const textSize = isAction && notif?.questionOnly ? "text-[13px]" : "text-[11px]";
  const messages = useStore((s) => (sessionId ? (s.messages?.get(sessionId) ?? EMPTY_MESSAGES) : EMPTY_MESSAGES));
  const sourceContext = useMemo(
    () => (notif ? getNotificationSourceContext(notif, messages, messageId) : null),
    [messageId, messages, notif],
  );
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const canSendQuickReply =
    !!sessionId && !!notif && questionViews.length > 0 && questionViews.every((q) => answersByQuestion[q.key]?.trim());

  useEffect(() => {
    setAnswersByQuestion({});
    setHistoryOpen(false);
  }, [notif?.id, isDone]);
  const toggleLabel = isReview
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

  const sendQuickReply = useCallback(
    (e: SyntheticEvent) => {
      e.stopPropagation();
      if (!sessionId || !notif || !canSendQuickReply) return;
      runAfterNotificationOwnerThreadSelected({
        notification: notif,
        currentThreadKey,
        onSelectThread,
        action: () => {
          const threadKey = resolveNotificationOwnerThreadKey(notif);
          const content = formatNeedsInputResponse(notif.summary ?? summary, questionViews, answersByQuestion);
          api
            .sendNeedsInputResponse(sessionId, notif.id, {
              content,
              threadKey,
              ...(threadKey !== MAIN_THREAD_KEY ? { questId: notif.questId ?? threadKey } : {}),
            })
            .then(() => {
              useStore.getState().requestBottomAlignOnNextUserMessage?.(sessionId);
              setAnswersByQuestion({});
            })
            .catch(() => {});
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

  const selectedThreadKey = currentThreadKey ? normalizeThreadKey(currentThreadKey) : undefined;
  if (
    isAction &&
    notif &&
    selectedThreadKey &&
    selectedThreadKey !== ALL_THREADS_KEY &&
    !isNotificationOwnerSelected(notif, selectedThreadKey)
  ) {
    return null;
  }

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
  const voiceThreadKey = notif ? resolveNotificationOwnerThreadKey(notif) : MAIN_THREAD_KEY;
  const voiceThreadTitle = voiceThreadKey === MAIN_THREAD_KEY ? "Main Thread" : (notif?.questId ?? voiceThreadKey);

  return (
    <div
      className={`inline-flex max-w-full flex-col items-start gap-1 mt-2 px-2 py-0.5 rounded-xl ${textSize} font-medium transition-opacity ${
        body ? "w-full sm:w-[min(44rem,100%)]" : questionViews.length > 0 ? "w-full sm:w-[min(30rem,100%)]" : ""
      } ${
        isDone
          ? `border border-cc-border bg-cc-hover/30 text-cc-muted ${isAction ? "" : "opacity-60"}`
          : isAction
            ? `${NEEDS_INPUT_CARD_CLASS} text-cc-attention`
            : isReview
              ? "border border-emerald-500/20 bg-emerald-500/5 text-cc-muted"
              : "border border-cc-border/60 bg-cc-hover/20 text-cc-muted"
      }`}
      data-notification-id={notif?.id ?? notificationId ?? ""}
      data-notification-category={category}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5">
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
        {isAction && isDone ? (
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary [@media(pointer:coarse)]:min-h-11"
          >
            <span className="min-w-0 flex-1 break-words">{label}</span>{" "}
            <span className="shrink-0 text-[10px]">
              {notif?.resolutionNotice?.source === "response" ? "Answered" : "Handled"}
            </span>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              className={`size-3 shrink-0 ${historyOpen ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>
        ) : (
          <span className={`min-w-0 ${isDone ? "line-through" : ""}`}>{label}</span>
        )}

        {!isAction && replyButton}
      </div>

      {isAction && isDone && historyOpen && (
        <div
          className="w-full space-y-3 border-t border-cc-border pt-2 pb-1 pl-5 text-[11px]"
          data-testid="notification-response-history"
        >
          {body && <NotificationBody body={body} sessionId={sessionId} />}
          <div className="space-y-2">
            <div className="font-medium">{questionViews.length > 1 ? "Original questions" : "Original question"}</div>
            {(questionViews.length ? questionViews.map((question) => question.prompt) : [label]).map(
              (prompt, index) => (
                <div key={index} className="whitespace-pre-wrap break-words text-cc-fg">
                  {prompt}
                </div>
              ),
            )}
          </div>
          {sessionId && notif ? (
            <NeedsInputResponseHistory
              key={`${sessionId}:${notif.id}`}
              sessionId={sessionId}
              notificationId={notif.id}
            />
          ) : (
            <div>No saved response is available.</div>
          )}
        </div>
      )}

      {!isDone && body && (
        <div className="w-full pl-5 pb-1">
          <NotificationBody body={body} sessionId={sessionId} />
        </div>
      )}

      {!isDone && questionViews.length > 0 && (
        <div
          className="flex w-full max-w-full flex-col items-stretch gap-1 pl-5"
          data-testid="notification-answer-actions"
        >
          {questionViews.map((question, index) => (
            <div key={question.key} className="space-y-1.5" data-testid="notification-question-block">
              {shouldShowNeedsInputQuestionPrompt({
                prompt: question.prompt,
                title: label,
                questionCount: questionViews.length,
              }) && (
                <div className={`${textSize} font-medium leading-snug text-cc-fg`}>
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
              {sessionId && notif && (
                <NeedsInputAnswerField
                  sessionId={sessionId}
                  notification={notif}
                  question={question}
                  questionCount={questionViews.length}
                  value={answersByQuestion[question.key] ?? ""}
                  onChange={(value) => setQuestionAnswer(question.key, value)}
                  placeholder="Your answer"
                  sourceContext={sourceContext}
                  threadKey={voiceThreadKey}
                  threadTitle={voiceThreadTitle}
                  className="w-full min-w-0"
                  onSubmit={sendQuickReply}
                />
              )}
              {questionViews.length === 1 && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5" data-testid="notification-answer-footer">
                  <button
                    type="button"
                    onClick={sendQuickReply}
                    disabled={!canSendQuickReply}
                    className={NEEDS_INPUT_SEND_BUTTON_CLASS}
                  >
                    Reply
                  </button>
                  {replyButton}
                </div>
              )}
            </div>
          ))}
          {questionViews.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={sendQuickReply}
                disabled={!canSendQuickReply}
                className={NEEDS_INPUT_SEND_BUTTON_CLASS}
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

/**
 * Decision context carried by the notification itself, so it stays visible even when no chat text precedes it.
 * Its Markdown opts into the feed's Comment / Copy selection menu; the card renders after the anchoring
 * assistant message's own content, so comments anchor to that message without shifting earlier passages.
 */
function NotificationBody({ body, sessionId }: { body: string; sessionId?: string }) {
  return (
    <div
      className="w-full min-w-0 border-t border-cc-border pt-1.5 font-normal text-cc-fg"
      data-testid="notification-body"
    >
      <MarkdownContent
        text={body}
        size="sm"
        sessionId={sessionId}
        questLinkSurface="chat-feed"
        wrapLongContent
        enableChatSelectionMenu
      />
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
  category: SessionNotification["category"];
}): SessionNotification | null {
  const notifications = useStore.getState().sessionNotifications.get(sessionId);
  if (!notifications) return null;
  if (notificationId) return notifications.find((n) => n.id === notificationId && n.category === category) ?? null;
  if (!messageId) return null;
  return notifications.find((n) => n.messageId === messageId && n.category === category) ?? null;
}
