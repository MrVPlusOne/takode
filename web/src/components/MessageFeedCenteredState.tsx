import type { ReactNode } from "react";
import { SleepingTako } from "./EmptyState.js";
import { Spinner } from "./LoadingIndicators.js";
import { FeedStatusPill } from "./MessageFeedStatus.js";
import { QuestDescriptionSummaryCard } from "./QuestDescriptionSummaryCard.js";

export function MessageFeedCenteredState({
  variant,
  topControls,
  clearancePx,
  sessionId,
  threadKey,
  onSelectThread,
  onVisibleHeightChange,
  questId,
}: {
  variant: "loading" | "empty";
  topControls: ReactNode;
  clearancePx: number;
  sessionId: string;
  threadKey: string;
  onSelectThread?: (threadKey: string) => void;
  onVisibleHeightChange: (height: number) => void;
  /** Leader quest thread whose description card replaces the empty placeholder. */
  questId?: string;
}) {
  const loading = variant === "loading";
  const placeholder = (
    <div
      data-testid="message-feed-centered-state"
      className="flex h-full flex-col items-center justify-center gap-4 select-none px-6"
      style={clearancePx > 0 ? { paddingBottom: clearancePx } : undefined}
    >
      {loading ? <Spinner className="w-5 h-5 text-cc-primary" /> : <SleepingTako className="h-24 w-24" />}
      <div className="text-center">
        <p className="text-sm text-cc-fg font-medium mb-1">
          {loading ? "Loading conversation..." : "Start a conversation"}
        </p>
        <p className="text-xs text-cc-muted leading-relaxed">
          {loading ? "Restoring recent history for this session." : "Send a message to begin."}
        </p>
      </div>
    </div>
  );
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      {topControls}
      {questId && !loading ? (
        // A quest thread with no messages yet still says what the quest is about,
        // placed where the card opens a thread once messages arrive.
        <div
          className="h-full overflow-y-auto px-2 py-4 sm:px-4 sm:py-6"
          style={clearancePx > 0 ? { paddingBottom: clearancePx } : undefined}
        >
          <div className="mx-auto h-full max-w-3xl">
            <QuestDescriptionSummaryCard
              questId={questId}
              sessionId={sessionId}
              questLinkSurface="chat-feed"
              fallback={placeholder}
            />
          </div>
        </div>
      ) : (
        placeholder
      )}
      <FeedStatusPill
        sessionId={sessionId}
        onVisibleHeightChange={onVisibleHeightChange}
        currentThreadKey={threadKey}
        onSelectThread={onSelectThread}
      />
    </div>
  );
}
