import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api.js";
import { useStore } from "../store.js";
import { connectSession } from "../ws.js";
import type { ChatMessage, PendingCodexInput, SideChatRecord } from "../types.js";
import { getRecoverableSessionConnectionPresentation } from "../utils/recoverable-session-connection.js";
import { MessageBubble } from "./MessageBubble.js";
import { getSideChatContextStatus, SideChatContextBadge } from "./SideChatControls.js";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PENDING_CODEX_INPUTS: PendingCodexInput[] = [];

type SideChatStatusTone = "info" | "warning" | "error" | "success";

interface SideChatStatusItem {
  key: string;
  label: string;
  detail: string;
  tone: SideChatStatusTone;
}

function statusToneClass(tone: SideChatStatusTone): string {
  switch (tone) {
    case "success":
      return "border-cc-success/30 bg-cc-success/10 text-cc-success";
    case "warning":
      return "border-cc-attention-border bg-cc-attention-bg text-cc-attention";
    case "error":
      return "border-cc-error/35 bg-cc-error/10 text-cc-error";
    case "info":
    default:
      return "border-cc-border bg-cc-hover/40 text-cc-muted";
  }
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown Side Chat send failure.";
}

function latestPermissionDenial(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "system" && message.variant === "denied") return message;
  }
  return null;
}

function SideChatStatusStrip({ items }: { items: SideChatStatusItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="border-b border-cc-border bg-cc-card px-3 py-2" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            className={`min-w-0 max-w-full rounded-md border px-2 py-1 text-[11px] leading-snug ${statusToneClass(
              item.tone,
            )}`}
            title={item.detail}
          >
            <span className="font-medium">{item.label}</span>
            <span className="ml-1 text-current/80">{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SideChatPanel({
  rootSessionId,
  sideChat,
  onClose,
}: {
  rootSessionId: string;
  sideChat: SideChatRecord;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<{ label: string; detail: string } | null>(null);
  const messages = useStore((s) => s.messages.get(sideChat.childSessionId) ?? EMPTY_MESSAGES);
  const loading = useStore((s) => s.historyLoading.get(sideChat.childSessionId) ?? false);
  const childSession = useStore((s) => s.sessions.get(sideChat.childSessionId));
  const rootSession = useStore((s) => s.sessions.get(rootSessionId));
  const childSessionStatus = useStore((s) => s.sessionStatus.get(sideChat.childSessionId) ?? null);
  const childConnectionStatus = useStore((s) => s.connectionStatus.get(sideChat.childSessionId) ?? "disconnected");
  const childCliConnected = useStore((s) => s.cliConnected.get(sideChat.childSessionId) ?? false);
  const childCliEverConnected = useStore((s) => s.cliEverConnected.get(sideChat.childSessionId) ?? false);
  const childCliDisconnectReason = useStore((s) => s.cliDisconnectReason.get(sideChat.childSessionId) ?? null);
  const serverReachable = useStore((s) => s.serverReachable ?? true);
  const childStreamingOutputTokens = useStore((s) => s.streamingOutputTokens.get(sideChat.childSessionId) ?? 0);
  const pendingPermissions = useStore((s) => s.pendingPermissions.get(sideChat.childSessionId)?.size ?? 0);
  const pendingCodexInputs = useStore(
    (s) => s.pendingCodexInputs.get(sideChat.childSessionId) ?? EMPTY_PENDING_CODEX_INPUTS,
  );
  const visibleMessages = messages.filter((message) => !message.ephemeral);
  const contextStatus = getSideChatContextStatus(sideChat);
  const permissionDenial = latestPermissionDenial(visibleMessages);
  const childConnectionPresentation = getRecoverableSessionConnectionPresentation({
    backendState: childSession?.backend_state,
    browserConnectionStatus: childConnectionStatus,
    cliConnected: childCliConnected,
    cliEverConnected: childCliEverConnected,
    idlePaused: childCliDisconnectReason === "idle_limit",
    serverReachable,
  });
  const childUnavailable = !childSession;
  const rootUnavailable = !rootSession;
  const childBlocked =
    childSession?.backend_state === "broken" || childSession?.backend_state === "recovery_suppressed";
  const canSend = serverReachable && !rootUnavailable && !childUnavailable && !childBlocked;

  useEffect(() => {
    setSendError(null);
  }, [sideChat.id, sideChat.childSessionId]);

  useEffect(() => {
    if (!sendNotice) return;
    const timer = setTimeout(() => setSendNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [sendNotice]);

  const statusItems = useMemo<SideChatStatusItem[]>(() => {
    const items: SideChatStatusItem[] = [];
    if (!serverReachable) {
      items.push({
        key: "server-offline",
        label: "Takode disconnected",
        detail: "Reconnect to Takode before sending in Side Chat.",
        tone: "error",
      });
    } else if (rootUnavailable) {
      items.push({
        key: "root-missing",
        label: "Root unavailable",
        detail: "Takode cannot route Side Chat sends without the root session.",
        tone: "error",
      });
    } else if (childUnavailable) {
      items.push({
        key: "child-missing",
        label: "Hidden session unavailable",
        detail: "This Side Chat cannot receive messages until its hidden child session is restored.",
        tone: "error",
      });
    }

    if (childConnectionPresentation) {
      items.push({
        key: `child-${childConnectionPresentation.kind}`,
        label: childConnectionPresentation.label,
        detail: childConnectionPresentation.detail,
        tone: childConnectionPresentation.kind === "reconnecting" ? "warning" : "info",
      });
    }

    if (sending) {
      items.push({
        key: "sending",
        label: "Sending",
        detail: "Delivering your Side Chat message to Takode.",
        tone: "info",
      });
    }

    if (pendingCodexInputs.length > 0) {
      items.push({
        key: "queued",
        label: pendingCodexInputs.length === 1 ? "Queued send" : `${pendingCodexInputs.length} queued sends`,
        detail: "Waiting for the hidden Side Chat backend to accept queued Codex input.",
        tone: "warning",
      });
    } else if (sendNotice) {
      items.push({
        key: "send-notice",
        label: sendNotice.label,
        detail: sendNotice.detail,
        tone: "success",
      });
    }

    if (childSessionStatus === "running") {
      items.push({
        key: "generating",
        label: "Generating",
        detail:
          childStreamingOutputTokens > 0
            ? `Side Chat reply is in progress, ${childStreamingOutputTokens.toLocaleString()} output tokens so far.`
            : "Side Chat reply is in progress.",
        tone: "success",
      });
    }

    if (childSession?.backend_error) {
      items.push({
        key: "backend-error",
        label: "Backend error",
        detail: childSession.backend_error,
        tone: "error",
      });
    }

    if (pendingPermissions > 0) {
      items.push({
        key: "permission-needed",
        label: "Permission needed",
        detail:
          pendingPermissions === 1
            ? "The hidden Side Chat session is waiting on a permission decision."
            : `${pendingPermissions} permission requests are waiting in the hidden Side Chat session.`,
        tone: "warning",
      });
    }

    if (permissionDenial) {
      items.push({
        key: "permission-denied",
        label: "Permission denied",
        detail: `${permissionDenial.content} Side Chat remains read-only for repository and file state.`,
        tone: "warning",
      });
    }

    if (sendError) {
      items.push({
        key: "send-error",
        label: "Send failed",
        detail: sendError,
        tone: "error",
      });
    }

    return items;
  }, [
    childConnectionPresentation,
    childSession,
    childSessionStatus,
    childStreamingOutputTokens,
    childUnavailable,
    pendingCodexInputs.length,
    pendingPermissions,
    permissionDenial,
    rootUnavailable,
    sendError,
    sendNotice,
    sending,
    serverReachable,
  ]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending || !canSend) return;
    setSending(true);
    setSendError(null);
    setSendNotice(null);
    try {
      await api.sendSideChatMessage(rootSessionId, sideChat.id, content);
      setText("");
      connectSession(sideChat.childSessionId);
      setSendNotice(
        childCliConnected
          ? { label: "Accepted", detail: "Message accepted by the hidden Side Chat session." }
          : {
              label: "Queued",
              detail: "Message accepted and queued while the hidden Side Chat backend reconnects.",
            },
      );
    } catch (error) {
      setSendError(formatError(error));
      console.warn("[side-chat] failed to send Side Chat message", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-l border-cc-border bg-cc-card sm:w-[360px] lg:w-[420px]">
      <div className="flex items-start gap-3 border-b border-cc-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-cc-fg">Side Chat</h2>
            <span className="rounded-full border border-cc-border bg-cc-hover/60 px-2 py-0.5 text-[11px] text-cc-muted">
              {sideChat.messageCount}
            </span>
            <SideChatContextBadge sideChat={sideChat} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-cc-muted">{sideChat.anchorPreview || "Root reply"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
          aria-label="Close Side Chat"
          title="Close Side Chat"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="border-b border-cc-border bg-cc-hover/30 px-3 py-2 text-xs leading-relaxed text-cc-muted">
        Read-only Side Chat. Use this workspace for analysis and follow-up questions only. File and repo edits are
        blocked here; move any change work back to the main session or a quest workflow.
        {contextStatus.tone === "fallback" && (
          <div className="mt-2 rounded-md border border-cc-attention-border bg-cc-attention-bg px-2 py-1.5 text-cc-attention">
            Bounded replay context. Native fork was unavailable, so this Side Chat has bounded root context only.
            {sideChat.contextFallbackReason ? ` ${sideChat.contextFallbackReason}` : ""}
          </div>
        )}
        {contextStatus.tone === "unknown" && (
          <div className="mt-2 rounded-md border border-cc-border bg-cc-hover/50 px-2 py-1.5">
            Context provenance is unknown for this legacy Side Chat.
          </div>
        )}
      </div>
      <SideChatStatusStrip items={statusItems} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {loading && visibleMessages.length === 0 ? (
          <div className="text-xs text-cc-muted">Loading Side Chat...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-cc-border px-3 py-3 text-xs text-cc-muted">
            Ask a follow-up in this read-only Side Chat.
          </div>
        ) : (
          visibleMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              sessionId={sideChat.childSessionId}
              currentThreadKey="main"
              showSideChatActions={false}
            />
          ))
        )}
      </div>
      <div className="border-t border-cc-border p-3">
        <div className="rounded-lg border border-cc-border bg-cc-bg">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="Reply in Side Chat..."
            disabled={!canSend}
            className="min-h-[76px] w-full resize-none bg-transparent px-3 py-2 text-sm text-cc-fg outline-none placeholder:text-cc-muted"
          />
          <div className="flex items-center justify-between border-t border-cc-border/70 px-2 py-2">
            <span className="min-w-0 pr-2 text-[11px] text-cc-muted">
              {canSend ? "Read-only Side Chat" : "Side Chat send unavailable"}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim() || sending || !canSend}
              className="rounded-md bg-cc-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cc-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending" : pendingCodexInputs.length > 0 ? "Queue" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
