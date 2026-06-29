import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, SdkSessionInfo } from "../types.js";
import { attentionLedgerMessageIdForNotificationId } from "../utils/attention-records.js";
import { applySessionNotifications, type NotificationStatusSnapshot } from "../notification-status.js";
import { formatNeedsInputResponse, getNeedsInputQuestionViews } from "../utils/notification-questions.js";
import {
  getNotificationSourceContext,
  getNotificationTitle,
  normalizeNotificationSourceContext,
  shouldShowNeedsInputQuestionPrompt,
} from "../utils/notification-source-context.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { navigateToSessionMessageId, navigateToSessionThread, routeSessionRefForId } from "../utils/routing.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { NeedsInputSourceTarget } from "./NeedsInputSourceTarget.js";
import { NeedsInputAnswerField } from "./NeedsInputAnswerField.js";
import {
  getGlobalMutedNeedsInputEntries,
  getGlobalNeedsInputEntries,
  type GlobalNeedsInputEntry,
  type GlobalNeedsInputState,
} from "../utils/global-needs-input.js";

const MENU_TOP_PX = 44;
const CHAT_FEED_WIDTH_SOURCE_SELECTOR = '[data-chat-feed-width-source="true"]';
const MENU_DISMISS_CHAT_FEED_RATIO = 0.65;
const EMPTY_MESSAGES: ChatMessage[] = [];

export { getGlobalNeedsInputEntries } from "../utils/global-needs-input.js";

interface NeedsInputFetchRequest {
  key: string;
  sessionId: string;
  status: NotificationStatusSnapshot;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function needsInputFetchRequests(state: GlobalNeedsInputState): NeedsInputFetchRequest[] {
  return state.sdkSessions
    .filter((session) => {
      if (session.archived) return false;
      const activeNeedsInputCount =
        session.activeNeedsInputNotificationCount ??
        (session.notificationUrgency === "needs-input" ? (session.activeNotificationCount ?? 0) : 0);
      return activeNeedsInputCount > 0 || (session.mutedNeedsInputNotificationCount ?? 0) > 0;
    })
    .map((session) => {
      const status: NotificationStatusSnapshot = {
        notificationUrgency: session.notificationUrgency,
        activeNotificationCount: session.activeNotificationCount,
        activeNeedsInputNotificationCount: session.activeNeedsInputNotificationCount,
        activeReviewNotificationCount: session.activeReviewNotificationCount,
        mutedNeedsInputNotificationCount: session.mutedNeedsInputNotificationCount,
        notificationStatusVersion: session.notificationStatusVersion,
        notificationStatusUpdatedAt: session.notificationStatusUpdatedAt,
      };
      return {
        key: `${session.sessionId}:${session.notificationStatusVersion ?? ""}:${session.notificationStatusUpdatedAt ?? ""}`,
        sessionId: session.sessionId,
        status,
      };
    });
}

function jumpToNotification(entry: GlobalNeedsInputEntry, sdkSessions: SdkSessionInfo[]) {
  const threadKey = resolveNotificationOwnerThreadKey(entry.notification);
  const routeSessionId = routeSessionRefForId(entry.sessionId, sdkSessions);
  const fallbackMessageId =
    !entry.notification.messageId && threadKey !== MAIN_THREAD_KEY
      ? attentionLedgerMessageIdForNotificationId(entry.notification.id)
      : null;
  const messageId = entry.notification.messageId ?? fallbackMessageId;

  if (messageId) {
    navigateToSessionMessageId(entry.sessionId, messageId, {
      routeSessionId,
      threadKey,
      preserveMainThreadRoute: true,
    });
    return;
  }

  navigateToSessionThread(entry.sessionId, threadKey, false, routeSessionId, { preserveMainThreadRoute: true });
}

function getCurrentChatFeedWidth(): number {
  const feed = document.querySelector<HTMLElement>(CHAT_FEED_WIDTH_SOURCE_SELECTOR);
  const feedWidth = feed?.getBoundingClientRect().width ?? 0;
  return feedWidth > 0 ? feedWidth : window.innerWidth;
}

function shouldDismissAfterNavigation(popover: HTMLElement | null): boolean {
  const menuWidth = popover?.getBoundingClientRect().width ?? 0;
  const feedWidth = getCurrentChatFeedWidth();
  return menuWidth > 0 && feedWidth > 0 && menuWidth / feedWidth > MENU_DISMISS_CHAT_FEED_RATIO;
}

function markLocalNotificationDone(sessionId: string, notificationId: string) {
  const store = useStore.getState();
  const notifications = store.sessionNotifications.get(sessionId);
  if (!notifications) return;
  const nextNotifications = notifications.map((notification) =>
    notification.id === notificationId ? { ...notification, done: true } : notification,
  );
  store.setSessionNotifications(sessionId, nextNotifications);
  applySessionNotifications(sessionId, nextNotifications, getCurrentNotificationStatus(sessionId));
}

function getCurrentNotificationStatus(sessionId: string): NotificationStatusSnapshot {
  const session = useStore.getState().sdkSessions.find((entry) => entry.sessionId === sessionId);
  return {
    notificationUrgency: session?.notificationUrgency,
    activeNotificationCount: session?.activeNotificationCount,
    activeNeedsInputNotificationCount: session?.activeNeedsInputNotificationCount,
    activeReviewNotificationCount: session?.activeReviewNotificationCount,
    mutedNeedsInputNotificationCount: session?.mutedNeedsInputNotificationCount,
    notificationStatusVersion: session?.notificationStatusVersion,
    notificationStatusUpdatedAt: session?.notificationStatusUpdatedAt,
  };
}

function markLocalNotificationMuted(sessionId: string, notificationId: string, muted: boolean) {
  const store = useStore.getState();
  const notifications = store.sessionNotifications.get(sessionId);
  if (!notifications) return;
  const nextNotifications = notifications.map((notification) => {
    if (notification.id !== notificationId) return notification;
    if (muted) return { ...notification, muted: true, mutedAt: Date.now() };
    const { muted: _muted, mutedAt: _mutedAt, ...rest } = notification;
    return rest;
  });
  store.setSessionNotifications(sessionId, nextNotifications);
  applySessionNotifications(sessionId, nextNotifications, getCurrentNotificationStatus(sessionId));
}

function BellIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 8 1.5z" />
      <path d="M6 12a2 2 0 0 0 4 0" />
    </svg>
  );
}

function GlobalNeedsInputRow({
  entry,
  muted,
  onNavigate,
}: {
  entry: GlobalNeedsInputEntry;
  muted: boolean;
  onNavigate: (entry: GlobalNeedsInputEntry) => void;
}) {
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const [remoteSourceContext, setRemoteSourceContext] = useState<{ key: string; value: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [togglingMute, setTogglingMute] = useState(false);
  const messages = useStore((s) => s.messages?.get(entry.sessionId) ?? EMPTY_MESSAGES);
  const questionViews = useMemo(() => getNeedsInputQuestionViews(entry.notification), [entry.notification]);
  const canSendResponse = questionViews.length > 0 && questionViews.every((q) => answersByQuestion[q.key]?.trim());
  const canSubmitResponse = canSendResponse && !sending;
  const sessionLabel = entry.sessionNum == null ? entry.sessionName : `#${entry.sessionNum} ${entry.sessionName}`;
  const summary = getNotificationTitle(entry.notification);
  const ownerThreadKey = resolveNotificationOwnerThreadKey(entry.notification);
  const voiceThreadTitle =
    ownerThreadKey === MAIN_THREAD_KEY ? "Main Thread" : (entry.notification.questId ?? ownerThreadKey);
  const localSourceContext = useMemo(
    () => getNotificationSourceContext(entry.notification, messages),
    [entry.notification, messages],
  );
  const remoteContextKey = `${entry.sessionId}:${entry.notification.id}:${entry.notification.messageId ?? ""}`;
  const sourceContext =
    localSourceContext ?? (remoteSourceContext?.key === remoteContextKey ? remoteSourceContext.value : null);

  const setQuestionAnswer = useCallback((key: string, value: string) => {
    setDeliveryError(null);
    setAnswersByQuestion((prev) => ({ ...prev, [key]: value }));
  }, []);

  const jump = useCallback(() => {
    onNavigate(entry);
  }, [entry, onNavigate]);

  useEffect(() => {
    if (localSourceContext || !entry.notification.messageId) return;
    let cancelled = false;
    setRemoteSourceContext({ key: remoteContextKey, value: null });
    api.fetchNotificationContext(entry.sessionId, entry.notification.id).then((context) => {
      if (cancelled) return;
      setRemoteSourceContext({
        key: remoteContextKey,
        value: normalizeNotificationSourceContext(context, entry.notification),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [entry.notification, entry.sessionId, localSourceContext, remoteContextKey]);

  const sendResponse = useCallback(async () => {
    if (!canSubmitResponse) return;
    const threadKey = ownerThreadKey;
    const content = formatNeedsInputResponse(entry.notification.summary, questionViews, answersByQuestion);
    setSending(true);
    setDeliveryError(null);
    try {
      await api.sendNeedsInputResponse(entry.sessionId, entry.notification.id, {
        content,
        threadKey,
        ...(threadKey !== MAIN_THREAD_KEY ? { questId: entry.notification.questId ?? threadKey } : {}),
      });
      markLocalNotificationDone(entry.sessionId, entry.notification.id);
      useStore.getState().requestBottomAlignOnNextUserMessage?.(entry.sessionId);
      setAnswersByQuestion({});
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Please retry.";
      setDeliveryError(`Response could not be delivered. ${message}`);
    } finally {
      setSending(false);
    }
  }, [answersByQuestion, canSubmitResponse, entry, ownerThreadKey, questionViews]);

  const toggleMuted = useCallback(async () => {
    setTogglingMute(true);
    setMuteError(null);
    const nextMuted = !muted;
    try {
      await api.setNotificationMuted(entry.sessionId, entry.notification.id, nextMuted);
      markLocalNotificationMuted(entry.sessionId, entry.notification.id, nextMuted);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Please retry.";
      setMuteError(`${nextMuted ? "Mute" : "Unmute"} failed. ${message}`);
    } finally {
      setTogglingMute(false);
    }
  }, [entry.notification.id, entry.sessionId, muted]);

  return (
    <div
      className={`px-3 py-2.5 transition-colors hover:bg-cc-hover/35 ${muted ? "bg-cc-hover/15" : ""}`}
      data-muted={muted ? "true" : undefined}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            muted ? "border border-cc-muted/70 bg-cc-muted/45" : "bg-cc-attention"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[11px] font-medium text-cc-muted" title={sessionLabel}>
                  {sessionLabel}
                </span>
                {muted && (
                  <span className="shrink-0 rounded border border-cc-border/70 bg-cc-hover/35 px-1 py-px text-[10px] font-medium text-cc-muted">
                    Muted
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-cc-muted/55">
                  {formatRelativeTime(entry.notification.timestamp)}
                </span>
              </div>
              <NeedsInputSourceTarget title={summary} sourceContext={sourceContext} testIdPrefix="global-needs-input" />
            </div>
            <div className="mt-4 flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleMuted}
                disabled={togglingMute}
                className="inline-flex items-center rounded border border-cc-border/70 bg-cc-card px-2 py-0.5 text-[11px] font-medium text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-muted/45 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                aria-label={`${muted ? "Unmute" : "Mute"} ${summary}`}
              >
                {togglingMute ? "..." : muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={jump}
                className="inline-flex items-center rounded border border-cc-attention-border bg-cc-attention-bg px-2 py-0.5 text-[11px] font-medium text-cc-attention transition-colors hover:bg-cc-attention-bg/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-attention/45 cursor-pointer"
                aria-label={`Go to source for ${summary}`}
              >
                Go to
              </button>
            </div>
          </div>
        </div>
      </div>

      {questionViews.length > 0 && (
        <div className="mt-2 space-y-2 pl-3" data-testid="global-needs-input-answer-actions">
          {questionViews.map((question, index) => (
            <div key={question.key} className="space-y-1.5" data-testid="global-needs-input-question-block">
              {shouldShowNeedsInputQuestionPrompt({
                prompt: question.prompt,
                title: summary,
                questionCount: questionViews.length,
              }) && (
                <div className="text-[11px] leading-snug text-cc-fg/80">
                  {questionViews.length > 1 && <span className="text-cc-muted">{index + 1}. </span>}
                  {question.prompt}
                </div>
              )}
              {question.suggestedAnswers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {question.suggestedAnswers.map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => setQuestionAnswer(question.key, answer)}
                      className="max-w-full truncate rounded border border-cc-attention-border bg-cc-attention-bg px-2 py-0.5 text-[11px] text-cc-attention transition-colors hover:bg-cc-attention-bg/80 cursor-pointer"
                      title={`Use suggested answer: ${answer}`}
                    >
                      {answer}
                    </button>
                  ))}
                </div>
              )}
              <NeedsInputAnswerField
                sessionId={entry.sessionId}
                notification={entry.notification}
                question={question}
                questionCount={questionViews.length}
                value={answersByQuestion[question.key] ?? ""}
                onChange={(value) => setQuestionAnswer(question.key, value)}
                placeholder="Your answer"
                sourceContext={sourceContext}
                threadKey={ownerThreadKey}
                threadTitle={voiceThreadTitle}
                textareaClassName="border-cc-border/60 px-2 py-1 text-[12px] text-cc-fg"
                onClickStopsPropagation={false}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={sendResponse}
            disabled={!canSubmitResponse}
            className="rounded border border-cc-attention-border bg-cc-attention-bg px-2 py-0.5 text-[11px] text-cc-attention transition-colors hover:bg-cc-attention-bg/80 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
          >
            {sending ? "Sending..." : deliveryError ? "Retry" : "Send Response"}
          </button>
          {deliveryError && <p className="text-[10px] leading-snug text-cc-attention">{deliveryError}</p>}
          {muteError && <p className="text-[10px] leading-snug text-cc-error">{muteError}</p>}
        </div>
      )}
      {questionViews.length === 0 && muteError && (
        <p className="mt-2 pl-3 text-[10px] leading-snug text-cc-error">{muteError}</p>
      )}
    </div>
  );
}

function GlobalNeedsInputPopover({
  activeEntries,
  mutedEntries,
  sdkSessions,
  onClose,
  triggerRef,
}: {
  activeEntries: GlobalNeedsInputEntry[];
  mutedEntries: GlobalNeedsInputEntry[];
  sdkSessions: SdkSessionInfo[];
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const navigate = useCallback(
    (entry: GlobalNeedsInputEntry) => {
      const shouldDismiss = shouldDismissAfterNavigation(popoverRef.current);
      jumpToNotification(entry, sdkSessions);
      if (shouldDismiss) onClose();
    },
    [onClose, sdkSessions],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose, triggerRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed right-3 z-50 flex max-h-[min(78vh,38rem)] w-[min(42rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-card/98 shadow-xl"
      style={{ top: MENU_TOP_PX }}
      role="dialog"
      aria-label="Global needs-input notifications"
    >
      <div className="flex items-center justify-between border-b border-cc-border/50 px-3 py-2.5">
        <h2 className="text-[13px] font-medium text-cc-fg">
          Needs Input <span className="ml-1 text-[11px] text-cc-muted font-normal">({activeEntries.length})</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
          aria-label="Close"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="overflow-y-auto">
        <section className="divide-y divide-cc-border/20" aria-label="Active needs-input notifications">
          {activeEntries.length > 0 ? (
            activeEntries.map((entry) => (
              <GlobalNeedsInputRow
                key={`${entry.sessionId}:${entry.notification.id}`}
                entry={entry}
                muted={false}
                onNavigate={navigate}
              />
            ))
          ) : (
            <div className="px-3 py-5 text-center text-[12px] text-cc-muted">No active needs-input</div>
          )}
        </section>
        {mutedEntries.length > 0 && (
          <section className="border-t border-cc-border/60" aria-label="Muted needs-input notifications">
            <div className="flex items-center justify-between bg-cc-hover/20 px-3 py-1.5">
              <span className="text-[11px] font-medium text-cc-muted">Muted</span>
              <span className="text-[10px] text-cc-muted/70">{mutedEntries.length}</span>
            </div>
            <div className="divide-y divide-cc-border/20">
              {mutedEntries.map((entry) => (
                <GlobalNeedsInputRow
                  key={`${entry.sessionId}:${entry.notification.id}`}
                  entry={entry}
                  muted
                  onNavigate={navigate}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function GlobalNeedsInputMenu() {
  const { sessionNotifications, sdkSessions, sessionNames } = useStore(
    useShallow((s) => ({
      sessionNotifications: s.sessionNotifications,
      sdkSessions: s.sdkSessions,
      sessionNames: s.sessionNames,
    })),
  );
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fetchedKeysRef = useRef(new Set<string>());
  const state = useMemo(
    () => ({ sessionNotifications, sdkSessions, sessionNames }),
    [sessionNotifications, sdkSessions, sessionNames],
  );
  const entries = useMemo(() => getGlobalNeedsInputEntries(state), [state]);
  const mutedEntries = useMemo(() => getGlobalMutedNeedsInputEntries(state), [state]);
  const fetchRequests = useMemo(() => needsInputFetchRequests(state), [state]);

  useEffect(() => {
    for (const request of fetchRequests) {
      if (fetchedKeysRef.current.has(request.key)) continue;
      fetchedKeysRef.current.add(request.key);
      api
        .getSessionNotifications(request.sessionId)
        .then((notifications) => applySessionNotifications(request.sessionId, notifications, request.status))
        .catch((error) => {
          console.warn("Failed to load global needs-input notifications", error);
          fetchedKeysRef.current.delete(request.key);
        });
    }
  }, [fetchRequests]);

  const close = useCallback(() => setOpen(false), []);
  const count = entries.length;
  const hasMuted = mutedEntries.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors cursor-pointer ${
          count > 0
            ? "border-cc-attention-border bg-cc-attention-bg text-cc-attention hover:bg-cc-attention-bg/80"
            : "border-cc-border bg-cc-card text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        }`}
        aria-label={`${count} unresolved needs-input ${count === 1 ? "notification" : "notifications"} across sessions`}
        title={
          hasMuted
            ? "Needs-input notifications across sessions, including muted"
            : "Needs-input notifications across sessions"
        }
      >
        <span>{count}</span>
        <BellIcon className={`h-3.5 w-3.5 shrink-0 ${count > 0 ? "text-cc-attention" : "text-cc-muted"}`} />
      </button>
      {open && (
        <GlobalNeedsInputPopover
          activeEntries={entries}
          mutedEntries={mutedEntries}
          sdkSessions={sdkSessions}
          onClose={close}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
}
