import { useMemo } from "react";
import type { ChatMessage, ToolResultPreview } from "../types.js";
import type { ToolMsgGroup } from "../hooks/use-feed-model.js";
import { makeWorkerEventActivityItems } from "../utils/herd-event-classification.js";
import { isCodexReasoningDetailMessage, parseCodexReasoningDetail } from "../utils/codex-reasoning-detail.js";
import { CompactToolActivity, type CompactToolActivityItem } from "./CompactToolActivity.js";
import { HerdEventMessage } from "./MessageBubble.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolMessageItem } from "./ToolMessageGroup.js";
import { parseTakodeNotifyCommand } from "./ToolBlock.js";
import { NotificationMarker } from "./NotificationMarker.js";
import type { ToolResultScope } from "./ToolBlock.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { getMessageFeedBlockId, getToolGroupFeedBlockId } from "./message-feed-utils.js";

export type CompactFeedActivitySegment =
  | { kind: "tool"; groups: ToolMsgGroup[] }
  | { kind: "worker_event"; messages: ChatMessage[] }
  | { kind: "thought"; messages: ChatMessage[] };

/**
 * An assistant message whose only visible content is thinking or a reasoning
 * summary. Only agent text splits activity groups, so these join the group.
 */
export function isCompactThoughtMessage(msg: ChatMessage): boolean {
  if (msg.role !== "assistant" || msg.notification) return false;
  const metadata = msg.metadata;
  if (metadata?.leaderThreadRole || metadata?.threadAnswer || metadata?.codexMessagePhase) return false;
  if (isCodexReasoningDetailMessage(msg)) return true;
  // Judge by blocks, not `content`: history normalization copies thinking text
  // into `content`, so a thinking-only message has non-empty content.
  const blocks = msg.contentBlocks ?? [];
  return (
    blocks.length > 0 &&
    blocks.every((block) => block.type === "thinking") &&
    blocks.some((block) => block.type === "thinking" && block.thinking.trim().length > 0)
  );
}

function thoughtText(msg: ChatMessage): string {
  if (isCodexReasoningDetailMessage(msg)) return msg.content;
  return (msg.contentBlocks ?? [])
    .flatMap((block) => (block.type === "thinking" && block.thinking.trim() ? [block.thinking.trim()] : []))
    .join("\n\n");
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  return line
    .trim()
    .replace(/^[#>*\-\s]+/, "")
    .replace(/\*\*/g, "");
}

function thoughtPreview(msg: ChatMessage): string {
  if (!isCodexReasoningDetailMessage(msg)) return firstLine(thoughtText(msg));
  const parsed = parseCodexReasoningDetail(msg.content);
  return parsed.title !== "Reasoning" ? parsed.title : firstLine(parsed.body);
}

function makeThoughtActivityItems(messages: ChatMessage[]): CompactToolActivityItem[] {
  return messages.map((message) => ({
    id: message.id,
    name: "Thought",
    kind: "thought",
    input: {
      text: thoughtPreview(message),
      streaming: message.metadata?.codexReasoningDetail?.status === "streaming",
    },
    messageId: message.id,
    feedBlockId: getMessageFeedBlockId(message.id),
  }));
}

export function CompactFeedActivity({
  segments,
  sessionId,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  interactionMode = "default",
  toolResultOverrides,
  toolResultScope = "session",
  questLinkSurface = "legacy",
  defaultExpanded = false,
}: {
  segments: CompactFeedActivitySegment[];
  sessionId: string;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
  interactionMode?: "default" | "read-only";
  toolResultOverrides?: ReadonlyMap<string, ToolResultPreview>;
  toolResultScope?: ToolResultScope;
  questLinkSurface?: QuestLinkSurface;
  defaultExpanded?: boolean;
}) {
  const items = useMemo(
    () =>
      segments.flatMap((segment): CompactToolActivityItem[] => {
        if (segment.kind === "thought") return makeThoughtActivityItems(segment.messages);
        if (segment.kind === "worker_event") {
          return makeWorkerEventActivityItems(segment.messages).map((item) => ({
            ...item,
            feedBlockId: getMessageFeedBlockId(item.messageId),
          }));
        }
        return segment.groups.flatMap((group) =>
          group.items.map((item, index) => ({
            ...item,
            resultOverride: item.resultOverride ?? toolResultOverrides?.get(item.id),
            ...(index === 0 ? { feedBlockId: getToolGroupFeedBlockId(group) } : {}),
          })),
        );
      }),
    [segments, toolResultOverrides],
  );
  const toolItemsById = useMemo(
    () =>
      new Map(
        segments.flatMap((segment) =>
          segment.kind === "tool"
            ? segment.groups.flatMap((group) => group.items.map((item) => [item.id, item] as const))
            : [],
        ),
      ),
    [segments],
  );
  const messagesById = useMemo(
    () =>
      new Map(
        segments.flatMap((segment) =>
          segment.kind === "tool" ? [] : segment.messages.map((message) => [message.id, message] as const),
        ),
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

  const renderDetails = (item: CompactToolActivityItem) => {
    const message = item.messageId ? messagesById.get(item.messageId) : undefined;
    if (item.kind === "worker_event") {
      return message ? <HerdEventMessage message={message} showTimestamp={false} defaultExpanded /> : null;
    }
    if (item.kind === "thought") {
      return message ? (
        <div className="rounded-[10px] border border-cc-border bg-cc-card px-3 py-2">
          <MarkdownContent
            text={thoughtText(message)}
            size="sm"
            variant="conservative"
            sessionId={sessionId}
            wrapLongContent
            className="text-cc-muted"
            questLinkSurface={questLinkSurface}
          />
        </div>
      ) : null;
    }
    const toolItem = toolItemsById.get(item.id);
    if (!toolItem) return null;
    return (
      <ToolMessageItem
        item={toolItem}
        sessionId={sessionId}
        isCodexSession={isCodexSession}
        activeCodexTerminalIds={activeCodexTerminalIds}
        onOpenCodexTerminal={onOpenCodexTerminal}
        suppressNotificationMarker
        interactionMode={interactionMode}
        toolResultOverrides={toolResultOverrides}
        toolResultScope={toolResultScope}
        questLinkSurface={questLinkSurface}
      />
    );
  };

  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out] min-w-0" data-compact-tool-activity-row>
      <CompactToolActivity
        items={items}
        sessionId={sessionId}
        containedMessageIds={containedMessageIds}
        renderDetails={renderDetails}
        defaultExpanded={defaultExpanded}
      />
      {interactionMode !== "read-only" &&
        inlineNotifications.map((notification, index) => (
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
