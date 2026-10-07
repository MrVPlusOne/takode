import { useContext, useState } from "react";
import type { ToolItem, ToolMsgGroup } from "../hooks/use-feed-model.js";
import type { ToolResultPreview } from "../types.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { CompactToolActivity } from "./CompactToolActivity.js";
import { LiveCodexTerminalStub } from "./MessageFeedLiveActivity.js";
import { getToolGroupFeedBlockId } from "./message-feed-utils.js";
import { NotificationMarker } from "./NotificationMarker.js";
import { HidePawContext, PawTrailAvatar } from "./PawTrail.js";
import {
  ToolBlock,
  getToolIcon,
  getToolLabel,
  parseTakodeNotifyCommand,
  ToolIcon,
  type ToolResultScope,
} from "./ToolBlock.js";

interface ToolMessageGroupProps {
  group: ToolMsgGroup;
  sessionId: string;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
  suppressNotificationMarker?: boolean;
  interactionMode?: "default" | "read-only";
  toolResultOverrides?: ReadonlyMap<string, ToolResultPreview>;
  toolResultScope?: ToolResultScope;
  questLinkSurface?: QuestLinkSurface;
}

export function ToolMessageGroup(props: ToolMessageGroupProps) {
  const hidePaw = useContext(HidePawContext);
  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="flex items-start gap-2 sm:gap-3">
        {!hidePaw && <PawTrailAvatar />}
        <div className="flex-1 min-w-0">
          <ToolMessageGroupContent {...props} />
        </div>
      </div>
    </div>
  );
}

export function ToolMessageGroupContent({
  group,
  sessionId,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  suppressNotificationMarker,
  interactionMode = "default",
  toolResultOverrides,
  toolResultScope = "session",
  questLinkSurface = "legacy",
}: ToolMessageGroupProps) {
  const [open, setOpen] = useState(true);
  const iconType = getToolIcon(group.toolName);
  const label = getToolLabel(group.toolName);
  const count = group.items.length;
  const itemProps = {
    sessionId,
    isCodexSession,
    activeCodexTerminalIds,
    onOpenCodexTerminal,
    suppressNotificationMarker,
    interactionMode,
    toolResultOverrides,
    toolResultScope,
    questLinkSurface,
  };

  if (group.mixedToolNames) {
    return (
      <div className="flex flex-col gap-1.5" data-feed-block-id={getToolGroupFeedBlockId(group)}>
        {group.items.map((item, index) => (
          <ToolMessageItem
            key={item.id || index}
            item={item}
            {...itemProps}
            hideLabel={!group.mixedToolNames && group.toolName === "Bash"}
          />
        ))}
      </div>
    );
  }

  if (count === 1) {
    const item = group.items[0];
    return (
      <div data-feed-block-id={getToolGroupFeedBlockId(group)}>
        <ToolMessageItem item={item} {...itemProps} />
      </div>
    );
  }

  return (
    <div data-feed-block-id={getToolGroupFeedBlockId(group)}>
      <div className="border border-cc-border rounded-[10px] overflow-hidden bg-cc-card">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cc-hover transition-colors cursor-pointer"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`w-3 h-3 text-cc-muted transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <ToolIcon type={iconType} />
          <span className="text-xs font-medium text-cc-fg">{label}</span>
          <span className="text-[10px] text-cc-muted bg-cc-hover rounded-full px-1.5 py-0.5 tabular-nums font-medium">
            {count}
          </span>
        </button>

        {open && (
          <div className="border-t border-cc-border px-3 py-2 flex flex-col gap-1.5">
            {group.items.map((item, index) => (
              <ToolMessageItem
                key={item.id || index}
                item={item}
                {...itemProps}
                hideLabel={group.toolName === "Bash"}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One tool call; inside a compact activity line it renders only its details. */
export function ToolMessageItem({
  item,
  sessionId,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  suppressNotificationMarker,
  interactionMode = "default",
  toolResultOverrides,
  toolResultScope = "session",
  hideLabel = false,
  questLinkSurface = "legacy",
}: Omit<ToolMessageGroupProps, "group"> & { item: ToolItem; hideLabel?: boolean }) {
  const ownedResultScope = item.codexSubagent ? "overrides-only" : toolResultScope;
  const resultOverride = item.resultOverride ?? toolResultOverrides?.get(item.id);
  if (
    ownedResultScope !== "overrides-only" &&
    isCodexSession &&
    item.name === "Bash" &&
    activeCodexTerminalIds.has(item.id)
  ) {
    return (
      <LiveCodexTerminalStub
        sessionId={sessionId}
        toolUseId={item.id}
        input={item.input}
        onInspect={() => onOpenCodexTerminal(item.id)}
      />
    );
  }

  return (
    <ToolBlock
      name={item.name}
      input={item.input}
      toolUseId={item.id}
      sessionId={sessionId}
      parentMessageId={item.messageId}
      hideLabel={hideLabel}
      suppressNotificationMarker={suppressNotificationMarker}
      disableInlineSpecialCases={interactionMode === "read-only"}
      resultOverride={resultOverride}
      suppressStoredResult={ownedResultScope === "overrides-only"}
      readOnly={interactionMode === "read-only"}
      questLinkSurface={questLinkSurface}
    />
  );
}

export function CompactToolMessageGroups({
  groups,
  ...props
}: Omit<ToolMessageGroupProps, "group"> & {
  groups: ToolMsgGroup[];
}) {
  const items = groups.flatMap((group) =>
    group.items.map((item, index) => ({
      ...item,
      resultOverride: item.resultOverride ?? props.toolResultOverrides?.get(item.id),
      ...(index === 0 ? { feedBlockId: getToolGroupFeedBlockId(group) } : {}),
    })),
  );
  const toolItemsById = new Map(items.map((item) => [item.id, item]));
  const reviewNotifyMessageIds = getReviewNotifyMessageIds(items);
  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out] min-w-0" data-compact-tool-activity-row>
      <CompactToolActivity
        items={items}
        sessionId={props.sessionId}
        containedMessageIds={groups.map((group) => group.firstId)}
        renderDetails={(item) => {
          const toolItem = toolItemsById.get(item.id);
          return toolItem ? <ToolMessageItem item={toolItem} {...props} suppressNotificationMarker /> : null;
        }}
      />
      {props.interactionMode !== "read-only" &&
        reviewNotifyMessageIds.map((messageId, index) => (
          <div key={`${messageId ?? "notify"}:${index}`} className="mt-2">
            <NotificationMarker category="review" sessionId={props.sessionId} messageId={messageId} />
          </div>
        ))}
    </div>
  );
}

/**
 * Message IDs of `takode notify review` commands in compact activity, which keep an inline review
 * marker. A needs-input decision already renders as its own card on the message the server anchors
 * it to, often earlier prose, so its command stays an ordinary activity line. A marker for it would
 * find no notification on the command's message and show an empty "Needs input" chip.
 */
export function getReviewNotifyMessageIds(
  items: ReadonlyArray<Pick<ToolItem, "name" | "input" | "messageId">>,
): Array<string | undefined> {
  return items.flatMap((item) =>
    item.name === "Bash" && parseTakodeNotifyCommand(String(item.input.command ?? ""))?.category === "review"
      ? [item.messageId]
      : [],
  );
}
