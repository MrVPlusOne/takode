import type { ReactNode } from "react";
import type { ChatMessage } from "../../types.js";
import { useStore } from "../../store.js";
import { MessageBubble } from "../MessageBubble.js";
import { SideChatContextBadge } from "../SideChatControls.js";
import { Card, Section } from "./shared.js";
import { MOCK_SESSION_ID, MSG_ASSISTANT, PLAYGROUND_SIDE_CHAT_CHILD_SESSION_ID } from "./fixtures.js";

const PLAYGROUND_FALLBACK_REASON =
  "Codex native fork skipped: anchor is not the final assistant message in its Codex turn";

const PLAYGROUND_FALLBACK_SIDE_CHAT = {
  id: "st-playground-fallback",
  rootSessionId: MOCK_SESSION_ID,
  childSessionId: PLAYGROUND_SIDE_CHAT_CHILD_SESSION_ID,
  anchorMessageId: MSG_ASSISTANT.id,
  anchorHistoryIndex: 2,
  anchorPreview: "We can stage the migration instead of replacing auth in one pass.",
  createdAt: Date.now() - 30_000,
  updatedAt: Date.now() - 8_000,
  messageCount: 2,
  lastMessagePreview: "Use a feature flag and keep session cookie validation until parity tests pass.",
  seeded: true,
  contextStrategy: "bounded-replay" as const,
  contextFallbackReason: PLAYGROUND_FALLBACK_REASON,
};

function makeAssistantMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: Date.now() - 6_000,
  };
}

function PreviewMenuButton({ copied = false }: { copied?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Message options"
      title="Message options"
      className="inline-flex h-7 items-center gap-1 rounded-md border border-cc-border bg-cc-card/80 px-1.5 text-[11px] text-cc-muted shadow-sm"
    >
      {copied ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
          <path d="M3 8.5l3.5 3.5 6.5-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      )}
      <span>{copied ? "Copied Markdown" : "Actions"}</span>
    </button>
  );
}

function PreviewMenuPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 w-72 max-w-full rounded-lg border border-cc-border bg-cc-card py-1 text-[11px] text-cc-fg shadow-lg">
      {children}
    </div>
  );
}

function PreviewMenuItem({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <div className={`px-2.5 py-1.5 text-left ${muted ? "text-cc-muted leading-relaxed" : ""}`}>{children}</div>;
}

function ActionMenuPreview({ message, variant }: { message: ChatMessage; variant: "native" | "fallback" }) {
  return (
    <div className="border-t border-cc-border bg-cc-card px-4 py-4">
      <MessageBubble
        message={message}
        sessionId={MOCK_SESSION_ID}
        currentThreadKey="main"
        showSideChatActions={false}
      />
      <PreviewMenuButton />
      <PreviewMenuPanel>
        {variant === "native" ? (
          <PreviewMenuItem>Start Side Chat</PreviewMenuItem>
        ) : (
          <>
            <PreviewMenuItem muted>
              Native fork unavailable: {PLAYGROUND_FALLBACK_REASON} Bounded replay requires confirmation.
            </PreviewMenuItem>
            <PreviewMenuItem>Replay Side Chat</PreviewMenuItem>
            <PreviewMenuItem>Confirm replay Side Chat</PreviewMenuItem>
          </>
        )}
        <PreviewMenuItem>Reply to this message</PreviewMenuItem>
        <PreviewMenuItem>Copy as Markdown</PreviewMenuItem>
      </PreviewMenuPanel>
    </div>
  );
}

export function PlaygroundSideChatStates() {
  const sideChatMessages = useStore((s) => s.messages.get(PLAYGROUND_SIDE_CHAT_CHILD_SESSION_ID) ?? []);
  const nativeMessage = makeAssistantMessage(
    "playground-side-chat-native-action",
    "Native fork is available, so the compact action menu stays below this message without covering it.",
  );
  const fallbackMessage = makeAssistantMessage(
    "playground-side-chat-fallback-action",
    "Native fork is unavailable here, but the replay confirmation and reason stay in the menu.",
  );

  return (
    <Section title="Side Chat Actions" description="Assistant-message Side Chat action menu states">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card label="Root assistant reply with menu trigger and Side Chat count">
          <div className="space-y-4 border-t border-cc-border bg-cc-card px-4 py-4">
            <MessageBubble message={MSG_ASSISTANT} sessionId={MOCK_SESSION_ID} currentThreadKey="main" />
          </div>
        </Card>
        <Card label="Open read-only Side Chat panel">
          <div className="flex h-[360px] flex-col border-t border-cc-border bg-cc-card">
            <div className="flex items-start gap-3 border-b border-cc-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-cc-fg">Side Chat</h3>
                  <span className="rounded-full border border-cc-border bg-cc-hover/60 px-2 py-0.5 text-[11px] text-cc-muted">
                    2
                  </span>
                  <SideChatContextBadge sideChat={PLAYGROUND_FALLBACK_SIDE_CHAT} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-cc-muted">
                  We can stage the migration instead of replacing auth in one pass.
                </p>
              </div>
            </div>
            <div className="border-b border-cc-border bg-cc-hover/30 px-3 py-2 text-xs leading-relaxed text-cc-muted">
              Read-only Side Chat. Use this workspace for analysis and follow-up questions only. File and repo edits are
              blocked here; move any change work back to the main session or a quest workflow.
              <div className="mt-2 rounded-md border border-cc-attention-border bg-cc-attention-bg px-2 py-1.5 text-cc-attention">
                Bounded replay context. Native fork was unavailable, so this Side Chat has bounded root context only.
                {` ${PLAYGROUND_FALLBACK_REASON}`}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
              {sideChatMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  sessionId={PLAYGROUND_SIDE_CHAT_CHILD_SESSION_ID}
                  currentThreadKey="main"
                />
              ))}
            </div>
            <div className="border-t border-cc-border p-3">
              <div className="rounded-lg border border-cc-border bg-cc-bg">
                <textarea
                  readOnly
                  rows={2}
                  value="Can you compare the rollout risks?"
                  className="min-h-[56px] w-full resize-none bg-transparent px-3 py-2 text-sm text-cc-fg outline-none"
                />
                <div className="flex items-center justify-between border-t border-cc-border/70 px-2 py-2">
                  <span className="text-[11px] text-cc-muted">Read-only Side Chat</span>
                  <button type="button" className="rounded-md bg-cc-primary px-3 py-1.5 text-xs font-medium text-white">
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>
        <Card label="Native-available action menu keeps message clear">
          <ActionMenuPreview message={nativeMessage} variant="native" />
        </Card>
        <Card label="Fallback reason and replay stay in menu">
          <ActionMenuPreview message={fallbackMessage} variant="fallback" />
        </Card>
      </div>
    </Section>
  );
}
