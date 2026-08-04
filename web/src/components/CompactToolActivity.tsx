import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store.js";
import { parseFileReadCommand } from "../utils/terminal-command-preview.js";
import { getToolIcon, getToolLabel, ToolIcon } from "./ToolBlock.js";

export interface CompactToolActivityItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  messageId?: string;
}

const MAX_SUMMARY_PARTS = 3;

/** Return whether a tool can be safely hidden behind a passive activity summary. */
export function isCompactToolActivityItem(item: CompactToolActivityItem): boolean {
  const normalizedName = item.name.toLowerCase();
  if (
    normalizedName === "askuserquestion" ||
    normalizedName === "exitplanmode" ||
    normalizedName === "task" ||
    normalizedName === "agent" ||
    normalizedName.includes("request_user_input")
  ) {
    return false;
  }

  if (item.name !== "Bash") return true;
  return !/(?:^|\s)takode\s+notify(?:\s|$)/.test(String(item.input.command ?? ""));
}

interface ActivityCategory {
  key: string;
  items: CompactToolActivityItem[];
}

function getActivityCategory(item: CompactToolActivityItem): string {
  const name = item.name.toLowerCase();
  if (name === "bash") {
    return parseFileReadCommand(String(item.input.command ?? "")) ? "read" : "command";
  }
  if (name === "read" || name.includes("read_file")) return "read";
  if (name === "write" || name === "edit" || name === "notebookedit" || name.includes("apply_patch")) {
    return "edit";
  }
  if (name === "glob" || name === "grep" || name.includes("search_files") || name.includes("search_content")) {
    return "search";
  }
  if (name === "websearch" || name === "web_search") return "web-search";
  if (name === "webfetch" || name.includes("fetch")) return "fetch";
  if (name === "view_image" || name.includes("view_image")) return "image";
  if (name === "todowrite" || name === "taskcreate" || name === "taskupdate") return "tasks";
  return `tool:${item.name}`;
}

function groupActivity(items: CompactToolActivityItem[]): ActivityCategory[] {
  const categories = new Map<string, ActivityCategory>();
  for (const item of items) {
    const key = getActivityCategory(item);
    const category = categories.get(key);
    if (category) {
      category.items.push(item);
    } else {
      categories.set(key, { key, items: [item] });
    }
  }
  return [...categories.values()];
}

function conciseValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized;
}

function describeCategory(category: ActivityCategory): string {
  const count = category.items.length;
  const first = category.items[0];
  if (category.key === "read") return count === 1 ? "Read file" : "Read files";
  if (category.key === "command") return count === 1 ? "Ran command" : "Ran commands";
  if (category.key === "edit") return count === 1 ? "Edited file" : "Edited files";
  if (category.key === "image") return count === 1 ? "Viewed image" : "Viewed images";
  if (category.key === "tasks") return "Updated tasks";
  if (category.key === "fetch") return count === 1 ? "Fetched page" : "Fetched pages";
  if (category.key === "search") {
    const subject = count === 1 ? conciseValue(first.input.pattern ?? first.input.query) : null;
    return subject ? `Searched for ${subject}` : "Searched code";
  }
  if (category.key === "web-search") {
    const subject = count === 1 ? conciseValue(first.input.query) : null;
    return subject ? `Searched web for ${subject}` : "Searched web";
  }
  return `Used ${getToolLabel(first.name)}`;
}

function lowercaseFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
}

/** Build the short, human-readable label shown for a collapsed run of tools. */
export function summarizeToolActivity(items: CompactToolActivityItem[]): string {
  const categories = groupActivity(items);
  const visible = categories.slice(0, MAX_SUMMARY_PARTS).map(describeCategory);
  if (categories.length > MAX_SUMMARY_PARTS) {
    visible.push(`${categories.length - MAX_SUMMARY_PARTS} more`);
  }
  return visible.map((part, index) => (index === 0 ? part : lowercaseFirst(part))).join(", ");
}

export function CompactToolActivity({
  items,
  sessionId,
  containedMessageIds = [],
  children,
}: {
  items: CompactToolActivityItem[];
  sessionId?: string;
  containedMessageIds?: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandTargetId = useStore((state) => (sessionId ? state.expandAllInTurn.get(sessionId) : undefined));
  const summary = useMemo(() => summarizeToolActivity(items), [items]);
  const iconType = getToolIcon(items[0]?.name ?? "");

  useEffect(() => {
    if (expandTargetId && containedMessageIds.includes(expandTargetId)) setOpen(true);
  }, [containedMessageIds, expandTargetId]);

  if (items.length === 0) return null;

  return (
    <div data-testid="compact-tool-activity">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${items.length} tool ${items.length === 1 ? "call" : "calls"}: ${summary}`}
        title={`${open ? "Hide" : "Show"} ${items.length} tool ${items.length === 1 ? "call" : "calls"}`}
        className="group flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-cc-muted transition-colors hover:bg-cc-hover/50 hover:text-cc-fg cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="opacity-65">
          <ToolIcon type={iconType} />
        </span>
        <span className="truncate">{summary}</span>
      </button>
      {open && <div className="mt-1.5 space-y-2 border-l border-cc-border/70 pl-3">{children}</div>}
    </div>
  );
}
