import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, SideChatRecord } from "../types.js";
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
  const sideChatsEnabled = useSideChatsEnabled(sessionId);
  const sideChat = useStore((s) => {
    const sideChats = s.sessions.get(sessionId)?.slackThreads ?? {};
    return Object.values(sideChats).find((candidate) => candidate.anchorMessageId === message.id) ?? null;
  });
  const isRootAssistant = message.role === "assistant" && normalizeThreadKey(currentThreadKey || "main") === "main";
  if (!sideChatsEnabled || !isRootAssistant || message.metadata?.slackThreadId) return null;

  const handleClick = async () => {
    if (sideChat) {
      openSideChat(sessionId, sideChat);
      return;
    }
    setCreating(true);
    try {
      const created = await api.createSideChat(sessionId, message.id);
      openSideChat(sessionId, created.sideChat);
    } catch (error) {
      console.warn("[side-chat] failed to create Side Chat", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={creating}
      className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-cc-hover transition-all cursor-pointer disabled:cursor-wait disabled:opacity-60"
      title={sideChat ? `Open Side Chat (${sideChat.messageCount})` : "Start Side Chat"}
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
      {sideChat.lastMessagePreview && <span className="min-w-0 truncate">{sideChat.lastMessagePreview}</span>}
    </button>
  );
}
