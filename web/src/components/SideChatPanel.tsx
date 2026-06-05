import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { connectSession } from "../ws.js";
import type { ChatMessage, SideChatRecord } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";

const EMPTY_MESSAGES: ChatMessage[] = [];

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
  const messages = useStore((s) => s.messages.get(sideChat.childSessionId) ?? EMPTY_MESSAGES);
  const loading = useStore((s) => s.historyLoading.get(sideChat.childSessionId) ?? false);
  const visibleMessages = messages.filter((message) => !message.ephemeral);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await api.sendSideChatMessage(rootSessionId, sideChat.id, content);
      setText("");
      connectSession(sideChat.childSessionId);
    } catch (error) {
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
      </div>
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
            className="min-h-[76px] w-full resize-none bg-transparent px-3 py-2 text-sm text-cc-fg outline-none placeholder:text-cc-muted"
          />
          <div className="flex items-center justify-between border-t border-cc-border/70 px-2 py-2">
            <span className="text-[11px] text-cc-muted">Read-only Side Chat</span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className="rounded-md bg-cc-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cc-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
