import { useRef, useMemo, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { api } from "../api.js";
import { useStore, countUserPermissions } from "../store.js";
import {
  navigateToSession,
  navigateToSessionMessage,
  navigateToSessionMessageId,
  navigateToSessionThread,
  routeSessionRefForId,
  sessionHash,
  sessionThreadHash,
} from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { SessionHoverCard } from "./SessionHoverCard.js";
import { resolveSessionNavigation } from "../utils/session-navigation-resolver.js";
import { MessageLinkHoverCard } from "./MessageLinkHoverCard.js";
import type { ChatMessage } from "../types.js";
import { useHoverCardsSuppressed } from "./hover-card-suppression-context.js";

function threadKeyForMessageLinkTarget(message: ChatMessage | null): string | undefined {
  const metadata = message?.metadata;
  if (!metadata) return undefined;
  if (metadata.threadKey) return normalizeThreadKey(metadata.threadKey);
  const refs = metadata.threadRefs ?? [];
  const explicit = refs.find((ref) => ref.source !== "backfill" && ref.threadKey);
  const fallback = explicit ?? refs.find((ref) => ref.threadKey);
  return fallback?.threadKey ? normalizeThreadKey(fallback.threadKey) : undefined;
}

export function SessionInlineLink({
  sessionId,
  sessionNum,
  messageIndex,
  children,
  className,
  missingClassName,
  ariaLabel,
  title,
  dataTestId,
  threadKey,
  stopPropagation = false,
  hoverCardZIndexClassName,
  onNavigate,
}: {
  sessionId: string | null;
  sessionNum?: number | null;
  messageIndex?: number;
  children: ReactNode;
  className?: string;
  missingClassName?: string;
  ariaLabel?: string;
  title?: string;
  dataTestId?: string;
  threadKey?: string | null;
  stopPropagation?: boolean;
  hoverCardZIndexClassName?: string;
  onNavigate?: () => void;
}) {
  const hoverCardsSuppressed = useHoverCardsSuppressed();
  const sessions = useStore((s) => s.sessions);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const sessionNames = useStore((s) => s.sessionNames);
  const sessionPreviews = useStore((s) => s.sessionPreviews);
  const sessionTaskHistory = useStore((s) => s.sessionTaskHistory);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const cliConnected = useStore((s) => s.cliConnected);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const askPermission = useStore((s) => s.askPermission);
  const cliDisconnectReason = useStore((s) => s.cliDisconnectReason);
  const diffFileStats = useStore((s) => s.diffFileStats);
  const syncedProjectionValues = useStore((s) => s.syncedProjectionValues);
  const syncedProjectionKeys = useStore((s) => s.syncedProjectionKeys);

  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    },
    [],
  );

  const sdkInfo = useMemo(() => {
    if (sessionId) {
      return sdkSessions.find((session) => session.sessionId === sessionId) ?? null;
    }
    if (sessionNum != null) {
      return sdkSessions.find((session) => session.sessionNum === sessionNum) ?? null;
    }
    return null;
  }, [sdkSessions, sessionId, sessionNum]);
  const resolvedSessionId = sessionId ?? sdkInfo?.sessionId ?? null;
  const resolvedNavigation = useMemo(
    () =>
      resolvedSessionId
        ? resolveSessionNavigation(
            {
              sessions,
              sdkSessions,
              syncedProjectionValues,
              syncedProjectionKeys,
              cliConnected,
              cliDisconnectReason,
              sessionStatus,
              pendingPermissions,
              askPermission,
              diffFileStats,
              sessionNames,
              sessionPreviews,
              countUserPermissions,
            },
            resolvedSessionId,
          )
        : null,
    [
      askPermission,
      cliConnected,
      cliDisconnectReason,
      diffFileStats,
      pendingPermissions,
      resolvedSessionId,
      sdkSessions,
      sessionNames,
      sessionPreviews,
      sessionStatus,
      sessions,
      syncedProjectionKeys,
      syncedProjectionValues,
    ],
  );
  const sessionItem = resolvedNavigation?.sidebarItem ?? null;
  const resolvedSessionNum = sessionItem?.sessionNum ?? sdkInfo?.sessionNum ?? sessionNum ?? null;

  function handleLinkMouseEnter(e: MouseEvent<HTMLAnchorElement>) {
    if (!sessionItem) return;
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    setHoverRect(e.currentTarget.getBoundingClientRect());
  }

  function handleLinkMouseLeave() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = setTimeout(() => setHoverRect(null), 100);
  }

  function handleHoverCardEnter() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
  }

  function handleHoverCardLeave() {
    setHoverRect(null);
  }

  const routeSessionRef = resolvedSessionId
    ? (resolvedSessionNum ?? routeSessionRefForId(resolvedSessionId, sdkSessions))
    : null;
  const href = resolvedSessionId
    ? messageIndex != null
      ? `${sessionHash(routeSessionRef ?? resolvedSessionId)}?msg=${messageIndex}`
      : sessionThreadHash(routeSessionRef ?? resolvedSessionId, threadKey)
    : "#";
  const sessionLabel = resolvedSessionNum != null ? `#${resolvedSessionNum}` : "session";
  const defaultTitle = resolvedSessionId
    ? messageIndex != null
      ? `Open session ${sessionLabel}, message ${messageIndex}`
      : threadKey
        ? `Open session ${sessionLabel}, thread ${threadKey}`
        : `Open session ${sessionLabel}`
    : `${sessionLabel} not found`;

  async function navigateToResolvedMessageTarget() {
    if (!resolvedSessionId || messageIndex == null) return;
    try {
      const message = await api.fetchMessagePreview(resolvedSessionId, messageIndex);
      if (message?.id) {
        const targetThreadKey = threadKeyForMessageLinkTarget(message);
        navigateToSessionMessageId(resolvedSessionId, message.id, {
          routeSessionId: routeSessionRef ?? resolvedSessionId,
          ...(targetThreadKey ? { threadKey: targetThreadKey, preserveMainThreadRoute: true } : {}),
        });
        return;
      }
    } catch {
      // Fall back to legacy index navigation below.
    }
    navigateToSessionMessage(resolvedSessionId, messageIndex);
  }

  return (
    <>
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (stopPropagation) e.stopPropagation();
          if (!resolvedSessionId) return;
          if (messageIndex != null) {
            void navigateToResolvedMessageTarget();
          } else if (threadKey) {
            navigateToSessionThread(resolvedSessionId, threadKey, false, routeSessionRef ?? resolvedSessionId);
          } else {
            navigateToSession(resolvedSessionId);
          }
          onNavigate?.();
        }}
        onMouseEnter={hoverCardsSuppressed ? undefined : handleLinkMouseEnter}
        onMouseLeave={hoverCardsSuppressed ? undefined : handleLinkMouseLeave}
        className={
          resolvedSessionId ? (className ?? "text-cc-primary hover:underline") : (missingClassName ?? "text-cc-muted")
        }
        title={title ?? defaultTitle}
        aria-label={ariaLabel}
        data-testid={dataTestId}
      >
        {children}
      </a>
      {!hoverCardsSuppressed &&
        resolvedSessionId &&
        sessionItem &&
        hoverRect &&
        (messageIndex != null ? (
          <MessageLinkHoverCard
            session={sessionItem}
            sessionName={resolvedNavigation?.name}
            anchorRect={hoverRect}
            messageIndex={messageIndex}
            onMouseEnter={handleHoverCardEnter}
            onMouseLeave={handleHoverCardLeave}
          />
        ) : (
          <SessionHoverCard
            session={sessionItem}
            sessionName={resolvedNavigation?.name}
            sessionPreview={resolvedNavigation?.preview}
            taskHistory={sessionTaskHistory.get(resolvedSessionId)}
            sessionState={sessions.get(resolvedSessionId)}
            cliSessionId={sdkInfo?.cliSessionId}
            anchorRect={hoverRect}
            onMouseEnter={handleHoverCardEnter}
            onMouseLeave={handleHoverCardLeave}
            zIndexClassName={hoverCardZIndexClassName}
          />
        ))}
    </>
  );
}
