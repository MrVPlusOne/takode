import { useEffect, useState } from "react";
import { ApiError, api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, SideChatPreflight, SideChatRecord } from "../types.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";

function openSideChat(sessionId: string, sideChat: SideChatRecord) {
  window.dispatchEvent(
    new CustomEvent("takode:open-side-chat", {
      detail: { sessionId, sideChatId: sideChat.id, childSessionId: sideChat.childSessionId },
    }),
  );
}

function useSideChatsEnabled(sessionId: string | undefined) {
  return useStore((s) => {
    if (!sessionId) return false;
    if (s.sessions.get(sessionId)?.isOrchestrator === true) return false;
    return s.sdkSessions.find((session) => session.sessionId === sessionId)?.isOrchestrator !== true;
  });
}

type SideChatContextTone = "native" | "fallback" | "unknown";

export function getSideChatContextStatus(sideChat: SideChatRecord): {
  label: string;
  detail: string;
  tone: SideChatContextTone;
} {
  if (sideChat.contextStrategy === "native-fork") {
    return {
      label: "Native fork",
      detail: "This Side Chat uses a backend-native fork of the root conversation.",
      tone: "native",
    };
  }
  if (sideChat.contextStrategy === "bounded-replay") {
    return {
      label: "Bounded replay",
      detail: sideChat.contextFallbackReason
        ? `This Side Chat uses bounded replay context. ${sideChat.contextFallbackReason}`
        : "This Side Chat uses bounded replay context because a native fork was unavailable.",
      tone: "fallback",
    };
  }
  return {
    label: "Legacy status unknown",
    detail: "This Side Chat was created before context provenance metadata was recorded.",
    tone: "unknown",
  };
}

export function SideChatContextBadge({ sideChat }: { sideChat: SideChatRecord }) {
  const status = getSideChatContextStatus(sideChat);
  const className =
    status.tone === "native"
      ? "border-cc-success/30 bg-cc-success/10 text-cc-success"
      : status.tone === "fallback"
        ? "border-cc-attention-border bg-cc-attention-bg text-cc-attention"
        : "border-cc-border bg-cc-hover/60 text-cc-muted";
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${className}`}
      title={status.detail}
    >
      {status.label}
    </span>
  );
}

function preflightFromError(error: unknown): SideChatPreflight | null {
  if (!(error instanceof ApiError)) return null;
  if (!error.body || typeof error.body !== "object") return null;
  const preflight = (error.body as { preflight?: unknown }).preflight;
  return preflight && typeof preflight === "object" ? (preflight as SideChatPreflight) : null;
}

export function SideChatButton({
  message,
  sessionId,
  currentThreadKey,
}: {
  message: ChatMessage;
  sessionId: string;
  currentThreadKey?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [fallbackConfirming, setFallbackConfirming] = useState(false);
  const [preflight, setPreflight] = useState<SideChatPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const sideChatsEnabled = useSideChatsEnabled(sessionId);
  const sideChat = useStore((s) => {
    const sideChats = s.sessions.get(sessionId)?.slackThreads ?? {};
    return Object.values(sideChats).find((candidate) => candidate.anchorMessageId === message.id) ?? null;
  });
  const isRootAssistant = message.role === "assistant" && normalizeThreadKey(currentThreadKey || "main") === "main";
  useEffect(() => {
    setFallbackConfirming(false);
    if (!sideChatsEnabled || !isRootAssistant || message.metadata?.slackThreadId || sideChat) {
      setPreflight(null);
      setPreflightError(null);
      return;
    }
    let cancelled = false;
    setPreflight(null);
    setPreflightError(null);
    const preflightSideChat = (api as { preflightSideChat?: typeof api.preflightSideChat }).preflightSideChat;
    if (typeof preflightSideChat !== "function") {
      setPreflightError("Native Side Chat preflight unavailable");
      return;
    }
    preflightSideChat(sessionId, message.id)
      .then((result) => {
        if (!cancelled) setPreflight(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreflightError(error instanceof Error ? error.message : "Side Chat unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [isRootAssistant, message.id, message.metadata?.slackThreadId, sessionId, sideChat, sideChatsEnabled]);

  if (!sideChatsEnabled || !isRootAssistant || message.metadata?.slackThreadId) return null;

  const handleClick = async () => {
    if (sideChat) {
      openSideChat(sessionId, sideChat);
      return;
    }
    setCreating(true);
    try {
      const created = await api.createSideChat(sessionId, message.id, { fallbackMode: "native-only" });
      openSideChat(sessionId, created.sideChat);
    } catch (error) {
      const errorPreflight = preflightFromError(error);
      if (errorPreflight) setPreflight(errorPreflight);
      console.warn("[side-chat] failed to create Side Chat", error);
    } finally {
      setCreating(false);
    }
  };

  const handleFallbackClick = async () => {
    if (!preflight?.fallback.available) return;
    if (!fallbackConfirming) {
      setFallbackConfirming(true);
      return;
    }
    setCreating(true);
    try {
      const created = await api.createSideChat(sessionId, message.id, { fallbackMode: "allow-bounded-replay" });
      openSideChat(sessionId, created.sideChat);
    } catch (error) {
      const errorPreflight = preflightFromError(error);
      if (errorPreflight) setPreflight(errorPreflight);
      console.warn("[side-chat] failed to create fallback Side Chat", error);
    } finally {
      setCreating(false);
      setFallbackConfirming(false);
    }
  };

  const nativeReady = Boolean(sideChat) || preflight?.native.eligible === true;
  const nativeReason = preflight?.native.reason ?? preflightError ?? "Checking native Side Chat support";
  const fallbackReason = preflight?.fallback.reason ?? nativeReason;
  const showUnavailableReason = !sideChat && preflight && !nativeReady;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={creating || !nativeReady}
        className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-cc-hover transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        title={
          sideChat
            ? `Open Side Chat (${sideChat.messageCount})`
            : nativeReady
              ? "Start Side Chat using native fork"
              : `Native Side Chat unavailable: ${nativeReason}`
        }
        aria-label={sideChat ? `Open Side Chat with ${sideChat.messageCount} messages` : "Start Side Chat"}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          className="w-3.5 h-3.5 text-cc-muted hover:text-cc-fg"
        >
          <path d="M3 4.5h10M3 8h7M3 11.5h5" strokeLinecap="round" />
          <path d="M11 9.5l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {!sideChat && preflight?.fallback.available && (
        <button
          type="button"
          onClick={handleFallbackClick}
          disabled={creating}
          className="inline-flex h-7 items-center rounded border border-cc-attention-border bg-cc-attention-bg px-2 text-[11px] font-medium text-cc-attention transition-colors hover:bg-cc-hover disabled:cursor-wait disabled:opacity-60"
          title={`Use bounded replay Side Chat. ${fallbackReason}`}
          aria-label={`Use bounded replay Side Chat. ${fallbackReason}`}
        >
          {fallbackConfirming ? "Confirm replay" : "Replay"}
        </button>
      )}
      {showUnavailableReason && (
        <span
          className="ml-1 max-w-[240px] whitespace-normal rounded-md border border-cc-attention-border bg-cc-attention-bg px-2 py-1 text-[10px] leading-tight text-cc-attention"
          role="status"
        >
          Native fork unavailable: {fallbackReason}
          {preflight.fallback.available ? " Bounded replay requires confirmation." : ""}
        </span>
      )}
    </>
  );
}

export function useSideChatForMessage(sessionId: string | undefined, message: ChatMessage) {
  const sideChatsEnabled = useSideChatsEnabled(sessionId);
  return useStore((s) => {
    if (!sideChatsEnabled || !sessionId || message.role !== "assistant" || message.metadata?.slackThreadId) {
      return null;
    }
    const sideChats = s.sessions.get(sessionId)?.slackThreads ?? {};
    return Object.values(sideChats).find((candidate) => candidate.anchorMessageId === message.id) ?? null;
  });
}

export function SideChatSummary({ sideChat, sessionId }: { sideChat: SideChatRecord; sessionId?: string }) {
  const count = sideChat.messageCount ?? 0;
  const label = `${count} ${count === 1 ? "reply" : "replies"}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (!sessionId) return;
        openSideChat(sessionId, sideChat);
      }}
      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-cc-border bg-cc-hover/40 px-2.5 py-1 text-left text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-3.5 w-3.5 shrink-0">
        <path d="M3 4.5h10M3 8h7M3 11.5h5" strokeLinecap="round" />
      </svg>
      <span className="shrink-0 font-medium text-cc-fg/80">{label}</span>
      <SideChatContextBadge sideChat={sideChat} />
      {sideChat.lastMessagePreview && <span className="min-w-0 truncate">{sideChat.lastMessagePreview}</span>}
    </button>
  );
}
