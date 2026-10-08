import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { navigateToNotification } from "../utils/notification-navigation.js";
import { getNotificationTitle } from "../utils/notification-source-context.js";
import { navigateToSession, sessionHash } from "../utils/routing.js";
import { useHoverCardsSuppressed } from "./hover-card-suppression-context.js";
import { formatSnoozeUntil } from "./NeedsInputSnoozeControl.js";

type NotificationLookup = SessionNotification | "loading" | "missing";

export function notificationLinkStatusLabel(
  notification: Pick<SessionNotification, "category" | "done" | "muted" | "snoozedUntil">,
): string {
  if (notification.done) return notification.category === "needs-input" ? "Answered" : "Done";
  if (notification.snoozedUntil !== undefined) return `Snoozed until ${formatSnoozeUntil(notification.snoozedUntil)}`;
  if (notification.muted) return "Muted";
  return "Open";
}

/**
 * Inline link for `session:<num>:notification:<n>` hrefs. The session's live notifications come from the
 * store when that session is loaded; otherwise the link fetches them on hover or click. Clicking opens the
 * notification card in its owner thread.
 */
export function NotificationInlineLink({
  sessionNum,
  notificationId,
  children,
  className,
  stopPropagation = false,
  onNavigate,
}: {
  sessionNum: number;
  notificationId: string;
  children: ReactNode;
  className?: string;
  stopPropagation?: boolean;
  onNavigate?: () => void;
}) {
  const hoverCardsSuppressed = useHoverCardsSuppressed();
  const sdkSessions = useStore((s) => s.sdkSessions);
  const sessionInfo = sdkSessions.find((session) => session.sessionNum === sessionNum) ?? null;
  const sessionId = sessionInfo?.sessionId ?? null;
  const storeNotification = useStore((s) =>
    sessionId ? s.sessionNotifications.get(sessionId)?.find((entry) => entry.id === notificationId) : undefined,
  );
  const [fetched, setFetched] = useState<NotificationLookup | null>(null);
  const lookup: NotificationLookup | null = storeNotification ?? fetched;
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    },
    [],
  );

  async function loadNotification(): Promise<SessionNotification | null> {
    if (storeNotification) return storeNotification;
    if (fetched && fetched !== "loading") return fetched === "missing" ? null : fetched;
    if (!sessionId) return null;
    setFetched("loading");
    const notifications = await api.getSessionNotifications(sessionId).catch(() => []);
    const found = notifications.find((entry) => entry.id === notificationId) ?? null;
    setFetched(found ?? "missing");
    return found;
  }

  function handleMouseEnter(e: MouseEvent<HTMLAnchorElement>) {
    if (!sessionId) return;
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    setHoverRect(e.currentTarget.getBoundingClientRect());
    if (!lookup) void loadNotification();
  }

  function handleMouseLeave() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = setTimeout(() => setHoverRect(null), 100);
  }

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (stopPropagation) e.stopPropagation();
    if (!sessionId) return;
    const notification = await loadNotification();
    if (notification) navigateToNotification(sessionId, notification, sdkSessions);
    else navigateToSession(sessionId);
    onNavigate?.();
  }

  return (
    <>
      <a
        href={sessionId ? sessionHash(sessionNum) : "#"}
        onClick={(e) => void handleClick(e)}
        onMouseEnter={hoverCardsSuppressed ? undefined : handleMouseEnter}
        onMouseLeave={hoverCardsSuppressed ? undefined : handleMouseLeave}
        className={sessionId ? (className ?? "text-cc-primary hover:underline") : "text-cc-muted"}
        title={sessionId ? `Open notification in session #${sessionNum}` : `Session #${sessionNum} not found`}
        data-testid="notification-inline-link"
      >
        {children}
      </a>
      {!hoverCardsSuppressed && sessionId && hoverRect && (
        <NotificationLinkHoverCard
          anchorRect={hoverRect}
          sessionLabel={sessionInfo?.name ? `#${sessionNum} ${sessionInfo.name}` : `#${sessionNum}`}
          lookup={lookup ?? "loading"}
          onMouseEnter={() => hideHoverTimerRef.current && clearTimeout(hideHoverTimerRef.current)}
          onMouseLeave={() => setHoverRect(null)}
        />
      )}
    </>
  );
}

function NotificationLinkHoverCard({
  anchorRect,
  sessionLabel,
  lookup,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorRect: DOMRect;
  sessionLabel: string;
  lookup: NotificationLookup;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const cardWidth = 320;
  const gap = 4;

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) el.style.left = `${Math.max(8, anchorRect.left - cardWidth - gap)}px`;
    if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }, [anchorRect, lookup]);

  const notification = typeof lookup === "string" ? null : lookup;
  const status = notification ? notificationLinkStatusLabel(notification) : null;
  const questionPrompts = notification?.questions?.map((question) => question.prompt) ?? [];

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 pointer-events-auto hidden-on-touch"
      style={{
        left: anchorRect.right + gap,
        top: anchorRect.top,
        width: cardWidth,
        transform: `scale(${zoomLevel})`,
        transformOrigin: "top left",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="notification-link-hover-card"
    >
      <div className="rounded-xl border border-cc-border bg-cc-card px-4 py-3 shadow-xl">
        <div className="flex items-center justify-between gap-3 text-[11px] text-cc-muted">
          <span className="truncate">
            {notification?.category === "review" ? "Review" : "Needs input"} · {sessionLabel}
          </span>
          {status && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 ${
                status === "Open" ? "bg-cc-warning/15 text-cc-warning" : "bg-cc-hover text-cc-muted"
              }`}
            >
              {status}
            </span>
          )}
        </div>
        {lookup === "loading" ? (
          <div className="mt-2 text-[12px] italic text-cc-muted/70">Loading notification…</div>
        ) : !notification ? (
          <div className="mt-2 text-[12px] italic text-cc-muted/70">Notification unavailable.</div>
        ) : (
          <>
            <div className="mt-1.5 text-[13px] font-semibold leading-snug text-cc-fg">
              {getNotificationTitle(notification)}
            </div>
            {questionPrompts.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] text-cc-fg/80">
                {questionPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
