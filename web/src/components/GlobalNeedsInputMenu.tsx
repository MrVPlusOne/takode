import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { sendToSession } from "../ws.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { attentionLedgerMessageIdForNotificationId } from "../utils/attention-records.js";
import { formatNeedsInputResponse, getNeedsInputQuestionViews } from "../utils/notification-questions.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { formatReplyContentForAssistant } from "../utils/reply-context.js";
import { navigateToSessionMessageId, navigateToSessionThread, routeSessionRefForId } from "../utils/routing.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";

const MENU_TOP_PX = 44;

export interface GlobalNeedsInputEntry {
  sessionId: string;
  sessionName: string;
  sessionNum: number | null;
  notification: SessionNotification;
}

interface GlobalNeedsInputState {
  sessionNotifications: Map<string, SessionNotification[]>;
  sdkSessions: SdkSessionInfo[];
  sessionNames: Map<string, string>;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function getSessionLabel({
  sessionId,
  sdkSession,
  sessionName,
}: {
  sessionId: string;
  sdkSession: SdkSessionInfo | undefined;
  sessionName: string | undefined;
}): { sessionName: string; sessionNum: number | null } {
  return {
    sessionName: sessionName || sdkSession?.name || `Session ${sessionId.slice(0, 8)}`,
    sessionNum: sdkSession?.sessionNum ?? null,
  };
}

export function getGlobalNeedsInputEntries(state: GlobalNeedsInputState): GlobalNeedsInputEntry[] {
  const sdkById = new Map(state.sdkSessions.map((session) => [session.sessionId, session]));
  const entries: GlobalNeedsInputEntry[] = [];

  for (const [sessionId, notifications] of state.sessionNotifications) {
    const sdkSession = sdkById.get(sessionId);
    if (sdkSession?.archived) continue;
    const label = getSessionLabel({
      sessionId,
      sdkSession,
      sessionName: state.sessionNames.get(sessionId),
    });

    for (const notification of notifications) {
      if (notification.done || notification.category !== "needs-input") continue;
      entries.push({
        sessionId,
        sessionName: label.sessionName,
        sessionNum: label.sessionNum,
        notification,
      });
    }
  }

  entries.sort((a, b) => b.notification.timestamp - a.notification.timestamp);
  return entries;
}

function needsInputFetchKeys(state: GlobalNeedsInputState): string[] {
  return state.sdkSessions
    .filter(
      (session) =>
        !session.archived &&
        session.notificationUrgency === "needs-input" &&
        (session.activeNotificationCount ?? 0) > 0,
    )
    .map(
      (session) =>
        `${session.sessionId}:${session.notificationStatusVersion ?? ""}:${session.notificationStatusUpdatedAt ?? ""}`,
    );
}

function parseFetchKey(key: string): string {
  return key.split(":")[0] ?? key;
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
    navigateToSessionMessageId(entry.sessionId, messageId, { routeSessionId, threadKey });
    return;
  }

  navigateToSessionThread(entry.sessionId, threadKey);
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

function GlobalNeedsInputRow({ entry, sdkSessions }: { entry: GlobalNeedsInputEntry; sdkSessions: SdkSessionInfo[] }) {
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [deliveryFallback, setDeliveryFallback] = useState(false);
  const questionViews = useMemo(() => getNeedsInputQuestionViews(entry.notification), [entry.notification]);
  const canSendResponse = questionViews.length > 0 && questionViews.every((q) => answersByQuestion[q.key]?.trim());
  const sessionLabel = entry.sessionNum == null ? entry.sessionName : `#${entry.sessionNum} ${entry.sessionName}`;
  const summary = entry.notification.summary || "Needs your input";

  const setQuestionAnswer = useCallback((key: string, value: string) => {
    setDeliveryFallback(false);
    setAnswersByQuestion((prev) => ({ ...prev, [key]: value }));
  }, []);

  const jump = useCallback(() => {
    jumpToNotification(entry, sdkSessions);
  }, [entry, sdkSessions]);

  const sendResponse = useCallback(() => {
    if (!canSendResponse) return;
    const threadKey = resolveNotificationOwnerThreadKey(entry.notification);
    const content = formatNeedsInputResponse(entry.notification.summary, questionViews, answersByQuestion);
    const replyContext = {
      ...(entry.notification.messageId ? { messageId: entry.notification.messageId } : {}),
      notificationId: entry.notification.id,
      previewText: summary,
    };
    const sent = sendToSession(entry.sessionId, {
      type: "user_message",
      content,
      deliveryContent: formatReplyContentForAssistant(content, replyContext),
      replyContext,
      session_id: entry.sessionId,
      threadKey,
      ...(threadKey !== MAIN_THREAD_KEY ? { questId: entry.notification.questId ?? threadKey } : {}),
    });
    if (!sent) {
      setDeliveryFallback(true);
      jumpToNotification(entry, sdkSessions);
      return;
    }
    useStore.getState().requestBottomAlignOnNextUserMessage?.(entry.sessionId);
    api.markNotificationDone(entry.sessionId, entry.notification.id, true).catch((error) => {
      console.warn("Failed to mark global needs-input notification done", error);
    });
    setAnswersByQuestion({});
    setDeliveryFallback(false);
  }, [answersByQuestion, canSendResponse, entry, questionViews, sdkSessions, summary]);

  return (
    <div className="px-3 py-2.5 hover:bg-cc-hover/35 transition-colors">
      <div className="flex items-start gap-2">
        <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-medium text-cc-muted" title={sessionLabel}>
              {sessionLabel}
            </span>
            <span className="shrink-0 text-[10px] text-cc-muted/55">
              {formatRelativeTime(entry.notification.timestamp)}
            </span>
          </div>
          <button
            type="button"
            onClick={jump}
            className="mt-0.5 block max-w-full truncate text-left text-[12px] text-cc-fg/95 hover:text-amber-100 cursor-pointer"
            title={summary}
          >
            {summary}
          </button>
        </div>
        <button
          type="button"
          onClick={jump}
          className="shrink-0 rounded border border-cc-border/60 px-2 py-0.5 text-[11px] text-cc-muted transition-colors hover:border-amber-400/40 hover:text-cc-fg cursor-pointer"
        >
          Jump
        </button>
      </div>

      {questionViews.length > 0 && (
        <div className="mt-2 space-y-2 pl-3" data-testid="global-needs-input-answer-actions">
          {questionViews.map((question, index) => (
            <div key={question.key} className="space-y-1.5" data-testid="global-needs-input-question-block">
              <div className="text-[11px] leading-snug text-cc-fg/80">
                {questionViews.length > 1 && <span className="text-cc-muted">{index + 1}. </span>}
                {question.prompt}
              </div>
              {question.suggestedAnswers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {question.suggestedAnswers.map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => setQuestionAnswer(question.key, answer)}
                      className="max-w-full truncate rounded border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200 transition-colors hover:bg-amber-400/20 cursor-pointer"
                      title={`Use suggested answer: ${answer}`}
                    >
                      {answer}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={answersByQuestion[question.key] ?? ""}
                onChange={(e) => setQuestionAnswer(question.key, e.currentTarget.value)}
                aria-label={`Answer for ${question.prompt}`}
                className="w-full rounded border border-cc-border/60 bg-cc-bg/70 px-2 py-1 text-[12px] text-cc-fg outline-none transition-colors placeholder:text-cc-muted/50 focus:border-amber-400/45"
                placeholder="Your answer"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={sendResponse}
            disabled={!canSendResponse}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
          >
            Send Response
          </button>
          {deliveryFallback && (
            <p className="text-[10px] leading-snug text-amber-200/80">
              Opened the target session because this response could not be delivered from here yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GlobalNeedsInputPopover({
  entries,
  sdkSessions,
  onClose,
}: {
  entries: GlobalNeedsInputEntry[];
  sdkSessions: SdkSessionInfo[];
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

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
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed right-3 z-50 flex max-h-[min(72vh,32rem)] w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-card/98 shadow-xl"
      style={{ top: MENU_TOP_PX }}
      role="dialog"
      aria-label="Global needs-input notifications"
    >
      <div className="flex items-center justify-between border-b border-cc-border/50 px-3 py-2.5">
        <h2 className="text-[13px] font-medium text-cc-fg">
          Needs Input <span className="ml-1 text-[11px] text-cc-muted font-normal">({entries.length})</span>
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
      <div className="overflow-y-auto divide-y divide-cc-border/20">
        {entries.map((entry) => (
          <GlobalNeedsInputRow
            key={`${entry.sessionId}:${entry.notification.id}`}
            entry={entry}
            sdkSessions={sdkSessions}
          />
        ))}
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
  const fetchedKeysRef = useRef(new Set<string>());
  const state = useMemo(
    () => ({ sessionNotifications, sdkSessions, sessionNames }),
    [sessionNotifications, sdkSessions, sessionNames],
  );
  const entries = useMemo(() => getGlobalNeedsInputEntries(state), [state]);
  const fetchKeys = useMemo(() => needsInputFetchKeys(state), [state]);

  useEffect(() => {
    for (const key of fetchKeys) {
      if (fetchedKeysRef.current.has(key)) continue;
      fetchedKeysRef.current.add(key);
      const sessionId = parseFetchKey(key);
      api
        .getSessionNotifications(sessionId)
        .then((notifications) => useStore.getState().setSessionNotifications(sessionId, notifications))
        .catch((error) => {
          console.warn("Failed to load global needs-input notifications", error);
          fetchedKeysRef.current.delete(key);
        });
    }
  }, [fetchKeys]);

  const close = useCallback(() => setOpen(false), []);
  const count = entries.length;

  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2 text-[11px] font-medium text-amber-200 transition-colors hover:border-amber-400/35 hover:bg-amber-400/15 cursor-pointer"
        aria-label={`${count} unresolved needs-input ${count === 1 ? "notification" : "notifications"} across sessions`}
        title="Needs-input notifications across sessions"
      >
        <span>{count}</span>
        <BellIcon className="h-3.5 w-3.5 shrink-0 text-amber-300" />
      </button>
      {open && <GlobalNeedsInputPopover entries={entries} sdkSessions={sdkSessions} onClose={close} />}
    </>
  );
}
