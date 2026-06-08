import type { ReactNode } from "react";
import type { ChatMessage, SideChatPreflight } from "../../types.js";
import { useStore } from "../../store.js";
import { MessageBubble } from "../MessageBubble.js";
import { SideChatButton, SideChatContextBadge } from "../SideChatControls.js";
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

const NATIVE_PREFLIGHT: SideChatPreflight = {
  ok: true,
  anchorMessageId: "playground-side-chat-native-action",
  backendType: "codex",
  native: { eligible: true },
  fallback: { available: false, requiresConfirmation: true },
};

const FALLBACK_PREFLIGHT: SideChatPreflight = {
  ok: true,
  anchorMessageId: "playground-side-chat-fallback-action",
  backendType: "codex",
  native: {
    eligible: false,
    reason: PLAYGROUND_FALLBACK_REASON,
    reasonCode: "codex-anchor-not-final-assistant",
  },
  fallback: {
    available: true,
    requiresConfirmation: true,
    reason: PLAYGROUND_FALLBACK_REASON,
    reasonCode: "codex-anchor-not-final-assistant",
  },
};

function makeAssistantMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: Date.now() - 6_000,
  };
}

function PreviewIconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
    >
      {children}
    </button>
  );
}

function ActionToolbarPreview({
  label,
  message,
  preflight,
  reasonDefaultOpen = false,
}: {
  label: string;
  message: ChatMessage;
  preflight: SideChatPreflight;
  reasonDefaultOpen?: boolean;
}) {
  return (
    <div className="relative min-h-[128px] overflow-visible border-t border-cc-border bg-cc-card px-4 py-4">
      <MessageBubble
        message={message}
        sessionId={MOCK_SESSION_ID}
        currentThreadKey="main"
        showSideChatActions={false}
      />
      <div className="absolute right-3 top-4 z-10 inline-flex max-w-[calc(100%-1.5rem)] items-center rounded-md border border-cc-border bg-cc-card/95 p-0.5 shadow-sm">
        <SideChatButton
          message={message}
          sessionId={MOCK_SESSION_ID}
          currentThreadKey="main"
          preflightOverride={preflight}
          reasonDefaultOpen={reasonDefaultOpen}
        />
        <PreviewIconButton label={`${label} reply`}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="h-3.5 w-3.5">
            <path d="M6 3L2 7l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 7h7a4 4 0 014 4v1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </PreviewIconButton>
        <PreviewIconButton label={`${label} copy`}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="h-3.5 w-3.5">
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 10V4.5A1.5 1.5 0 014.5 3H10" strokeLinecap="round" />
          </svg>
        </PreviewIconButton>
      </div>
    </div>
  );
}

export function PlaygroundSideChatStates() {
  const sideChatMessages = useStore((s) => s.messages.get(PLAYGROUND_SIDE_CHAT_CHILD_SESSION_ID) ?? []);
  const nativeMessage = makeAssistantMessage(
    NATIVE_PREFLIGHT.anchorMessageId,
    "Native fork is available, so the compact action layer should not reduce this message line width.",
  );
  const fallbackMessage = makeAssistantMessage(
    FALLBACK_PREFLIGHT.anchorMessageId,
    "Native fork is unavailable here, but the replay confirmation and reason stay compact.",
  );

  return (
    <Section title="Side Chat" description="Root reply affordance and hidden read-only Side Chat panel">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card label="Root assistant reply with compact overlaid action cluster">
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
        <Card label="Native-available action layer keeps message width">
          <ActionToolbarPreview label="Native Side Chat" message={nativeMessage} preflight={NATIVE_PREFLIGHT} />
        </Card>
        <Card label="Fallback reason and replay stay compact">
          <ActionToolbarPreview
            label="Fallback Side Chat"
            message={fallbackMessage}
            preflight={FALLBACK_PREFLIGHT}
            reasonDefaultOpen
          />
        </Card>
      </div>
    </Section>
  );
}
