import { useState } from "react";
import type { ToolMsgGroup } from "../hooks/use-feed-model.js";
import { CompactToolActivity } from "./CompactToolActivity.js";
import { LiveCodexTerminalStub } from "./MessageFeedLiveActivity.js";
import { getToolGroupFeedBlockId } from "./message-feed-utils.js";
import { PawTrailAvatar } from "./PawTrail.js";
import { ToolBlock, getToolIcon, getToolLabel, ToolIcon } from "./ToolBlock.js";

interface ToolMessageGroupProps {
  group: ToolMsgGroup;
  sessionId: string;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
}

export function ToolMessageGroup(props: ToolMessageGroupProps) {
  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="flex items-start gap-2 sm:gap-3">
        <PawTrailAvatar />
        <div className="flex-1 min-w-0">
          <ToolMessageGroupContent {...props} />
        </div>
      </div>
    </div>
  );
}

function ToolMessageGroupContent({
  group,
  sessionId,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
}: ToolMessageGroupProps) {
  const [open, setOpen] = useState(true);
  const iconType = getToolIcon(group.toolName);
  const label = getToolLabel(group.toolName);
  const count = group.items.length;

  if (count === 1) {
    const item = group.items[0];
    const showLiveCodexTerminalStub = isCodexSession && item.name === "Bash" && activeCodexTerminalIds.has(item.id);
    return (
      <div data-feed-block-id={getToolGroupFeedBlockId(group)}>
        {showLiveCodexTerminalStub ? (
          <LiveCodexTerminalStub
            sessionId={sessionId}
            toolUseId={item.id}
            input={item.input}
            onInspect={() => onOpenCodexTerminal(item.id)}
          />
        ) : (
          <ToolBlock
            name={item.name}
            input={item.input}
            toolUseId={item.id}
            sessionId={sessionId}
            parentMessageId={item.messageId}
          />
        )}
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
            {group.items.map((item, index) =>
              isCodexSession && item.name === "Bash" && activeCodexTerminalIds.has(item.id) ? (
                <LiveCodexTerminalStub
                  key={item.id || index}
                  sessionId={sessionId}
                  toolUseId={item.id}
                  input={item.input}
                  onInspect={() => onOpenCodexTerminal(item.id)}
                />
              ) : (
                <ToolBlock
                  key={item.id || index}
                  name={item.name}
                  input={item.input}
                  toolUseId={item.id}
                  sessionId={sessionId}
                  parentMessageId={item.messageId}
                  hideLabel={group.toolName === "Bash"}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CompactToolMessageGroups({
  groups,
  ...props
}: Omit<ToolMessageGroupProps, "group"> & {
  groups: ToolMsgGroup[];
}) {
  const items = groups.flatMap((group) => group.items);
  return (
    <div className="animate-[fadeSlideIn_0.2s_ease-out] flex items-start gap-2 sm:gap-3">
      <PawTrailAvatar />
      <div className="flex-1 min-w-0">
        <CompactToolActivity
          items={items}
          sessionId={props.sessionId}
          containedMessageIds={groups.map((group) => group.firstId)}
        >
          {groups.map((group) => (
            <ToolMessageGroupContent key={group.firstId} group={group} {...props} />
          ))}
        </CompactToolActivity>
      </div>
    </div>
  );
}
