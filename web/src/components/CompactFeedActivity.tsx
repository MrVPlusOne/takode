import { useMemo } from "react";
import type { ChatMessage } from "../types.js";
import type { ToolMsgGroup } from "../hooks/use-feed-model.js";
import { makeWorkerEventActivityItems } from "../utils/herd-event-classification.js";
import { CompactToolActivity, type CompactToolActivityItem } from "./CompactToolActivity.js";
import { HerdEventMessage } from "./MessageBubble.js";
import { ToolMessageGroupContent } from "./ToolMessageGroup.js";
import { parseTakodeNotifyCommand } from "./ToolBlock.js";
import { NotificationMarker } from "./NotificationMarker.js";

export type CompactFeedActivitySegment =
  | { kind: "tool"; groups: ToolMsgGroup[] }
  | { kind: "worker_event"; messages: ChatMessage[] };

export function CompactFeedActivity({
  segments,
  sessionId,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
}: {
  segments: CompactFeedActivitySegment[];
  sessionId: string;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
}) {
  const items = useMemo(
    () =>
      segments.flatMap((segment): CompactToolActivityItem[] =>
        segment.kind === "tool"
          ? segment.groups.flatMap((group) => group.items)
          : makeWorkerEventActivityItems(segment.messages),
      ),
    [segments],
  );
  const containedMessageIds = useMemo(
    () =>
      segments.flatMap((segment) =>
        segment.kind === "tool" ? segment.groups.map((group) => group.firstId) : segment.messages.map((msg) => msg.id),
      ),
    [segments],
  );
  const inlineNotifications = useMemo(
    () =>
      items.flatMap((item) => {
        if (item.name !== "Bash") return [];
        const match = parseTakodeNotifyCommand(String(item.input.command ?? ""));
        return match ? [{ ...match, messageId: item.messageId }] : [];
      }),
    [items],
  );

  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out] min-w-0" data-compact-tool-activity-row>
      <CompactToolActivity items={items} sessionId={sessionId} containedMessageIds={containedMessageIds}>
        {segments.map((segment, segmentIndex) =>
          segment.kind === "tool" ? (
            segment.groups.map((group) => (
              <ToolMessageGroupContent
                key={group.firstId}
                group={group}
                sessionId={sessionId}
                isCodexSession={isCodexSession}
                activeCodexTerminalIds={activeCodexTerminalIds}
                onOpenCodexTerminal={onOpenCodexTerminal}
                suppressNotificationMarker
              />
            ))
          ) : (
            <div key={`worker-events:${segment.messages[0]?.id ?? segmentIndex}`} className="space-y-1">
              {segment.messages.map((msg) => (
                <HerdEventMessage key={msg.id} message={msg} showTimestamp={false} defaultExpanded />
              ))}
            </div>
          ),
        )}
      </CompactToolActivity>
      {inlineNotifications.map((notification, index) => (
        <div key={`${notification.messageId ?? "notify"}:${notification.category}:${index}`} className="mt-2">
          <NotificationMarker
            category={notification.category}
            sessionId={sessionId}
            messageId={notification.messageId}
          />
        </div>
      ))}
    </div>
  );
}
