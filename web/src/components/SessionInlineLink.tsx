import {
  handleOpenInSideClick,
  openInSideOnScreen,
  openSessionInSide,
  openSessionMessageInSide,
  type SessionMessageTarget,
} from "../utils/side-column.js";
import { useRef, useMemo, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import {
  navigateToSession,
  navigateToSessionMessage,
  navigateToSessionMessageId,
  navigateToSessionThread,
  sessionHash,
  sessionThreadHash,
} from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { SessionHoverCard } from "./SessionHoverCard.js";
import { resolveSdkSessionNavigation } from "../utils/session-navigation-resolver.js";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
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
  const sdkInfo = useSdkSessionRow(sessionId, sessionNum);

  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    },
    [],
  );

  const resolvedSessionId = sessionId ?? sdkInfo?.sessionId ?? null;
  const resolvedNavigation = useMemo(() => (sdkInfo ? resolveSdkSessionNavigation(sdkInfo) : null), [sdkInfo]);
  const sessionTaskHistory = useStore((s) =>
    resolvedSessionId && hoverRect ? s.sessionTaskHistory.get(resolvedSessionId) : undefined,
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

  const routeSessionRef = resolvedSessionId ? (resolvedSessionNum ?? resolvedSessionId) : null;
  const href = resolvedSessionId
    ? messageIndex != null
      ? `${sessionHash(routeSessionRef ?? resolvedSessionId)}?msg=${messageIndex}`
      : sessionThreadHash(routeSessionRef ?? resolvedSessionId, threadKey)
    : undefined; // No placeholder "#": copied elsewhere it would become a link to the app's root.
  const sessionLabel = resolvedSessionNum != null ? `#${resolvedSessionNum}` : "session";
  const defaultTitle = resolvedSessionId
    ? messageIndex != null
      ? `Open session ${sessionLabel}, message ${messageIndex}`
      : threadKey
        ? `Open session ${sessionLabel}, thread ${threadKey}`
        : `Open session ${sessionLabel}`
    : `${sessionLabel} not found`;

  /** The linked message's stable ID and thread; null when it can't be found. */
  async function resolveMessageTarget(): Promise<SessionMessageTarget | null> {
    if (!resolvedSessionId || messageIndex == null) return null;
    const message = await api.fetchMessagePreview(resolvedSessionId, messageIndex);
    if (!message?.id) return null;
    const threadKey = threadKeyForMessageLinkTarget(message);
    return { messageId: message.id, ...(threadKey ? { threadKey } : {}) };
  }

  async function navigateToResolvedMessageTarget() {
    if (!resolvedSessionId || messageIndex == null) return;
    try {
      const target = await resolveMessageTarget();
      if (target) {
        navigateToSessionMessageId(resolvedSessionId, target.messageId, {
          routeSessionId: routeSessionRef ?? resolvedSessionId,
          ...(target.threadKey ? { threadKey: target.threadKey, preserveMainThreadRoute: true } : {}),
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
          const open = () => {
            if (messageIndex != null) {
              void navigateToResolvedMessageTarget();
            } else if (threadKey) {
              navigateToSessionThread(resolvedSessionId, threadKey, false, routeSessionRef ?? resolvedSessionId);
            } else {
              navigateToSession(resolvedSessionId);
            }
            onNavigate?.();
          };
          // The open-in-side click shows in the side column what a plain click shows in the main view:
          // the linked message in its thread, a leader's thread as that thread, else the session.
          const openInSideColumn = () =>
            messageIndex != null
              ? openSessionMessageInSide(resolvedSessionId, resolveMessageTarget())
              : threadKey
                ? openInSideOnScreen({
                    kind: "conversation",
                    threadKey: threadKey.toLowerCase(),
                    leaderId: resolvedSessionId,
                  })
                : openSessionInSide(resolvedSessionId);
          if (e.button === 0 && handleOpenInSideClick(e, openInSideColumn, open)) return;
          open();
        }}
        onMouseEnter={hoverCardsSuppressed ? undefined : handleLinkMouseEnter}
        onMouseLeave={hoverCardsSuppressed ? undefined : handleLinkMouseLeave}
        className={
          resolvedSessionId ? (className ?? "text-cc-primary hover:underline") : (missingClassName ?? "text-cc-muted")
        }
        title={title ?? defaultTitle}
        aria-label={ariaLabel}
        // Its hover card says more than a tooltip would, and in the same place.
        data-tooltip={hoverCardsSuppressed ? undefined : "off"}
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
            sessionName={resolvedNavigation?.sidebarItem.name}
            anchorRect={hoverRect}
            messageIndex={messageIndex}
            onMouseEnter={handleHoverCardEnter}
            onMouseLeave={handleHoverCardLeave}
          />
        ) : (
          <SessionHoverCard
            session={sessionItem}
            sessionName={resolvedNavigation?.sidebarItem.name}
            sessionPreview={resolvedNavigation?.sidebarItem.lastMessagePreview || undefined}
            taskHistory={sessionTaskHistory}
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
