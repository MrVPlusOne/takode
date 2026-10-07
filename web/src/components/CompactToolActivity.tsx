import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store.js";
import type { ToolResultPreview } from "../types.js";
import { parseTakodeBoardCommand } from "../utils/takode-tool-command.js";
import { parseFileReadCommand } from "../utils/terminal-command-preview.js";
import { isPureTakodeSendCommand } from "../utils/takode-send-command.js";
import { getDistinctChangeFilePaths } from "../utils/tool-rendering.js";
import { formatFileHeaderPath } from "./DiffViewer.js";
import { formatDuration, getPreview, getToolLabel, ToolBlockEmbeddedContext, ToolDurationBadge } from "./ToolBlock.js";
import { summarizeWorkerEventActivity } from "../utils/herd-event-classification.js";

export interface CompactToolActivityItem {
  id: string;
  name: string;
  /**
   * Tool input. A `thought` item carries its one-line preview in `text` (and
   * `streaming` while it is being written); a `worker_event` item carries
   * `eventCount` and an optional `summary` line.
   */
  input: Record<string, unknown>;
  messageId?: string;
  kind?: "tool" | "worker_event" | "thought";
  /** Result owned by this item (e.g. a native child tool); replaces the stored session result. */
  resultOverride?: ToolResultPreview;
  /** Feed navigation anchor rendered on this item's line. */
  feedBlockId?: string;
}

// Keep the fallback independent of viewport measurement so desktop/mobile and
// live/replayed renders make the same decision from the activity model alone.
const MAX_DESCRIPTIVE_TOOL_CALLS = 6;
const MAX_DESCRIPTIVE_TOOL_CATEGORIES = 3;
const MAX_DESCRIPTIVE_SUMMARY_LENGTH = 56;
// A collapsed group shows only its newest activities; older ones fold into "+N earlier".
const ROLLING_WINDOW_SIZE = 3;

/** Return whether a tool can be safely hidden behind a passive activity summary. */
export function isCompactToolActivityItem(item: CompactToolActivityItem): boolean {
  const normalizedName = item.name.toLowerCase();
  if (
    (normalizedName === "bash" && parseTakodeBoardCommand(item.input.command)?.subcommand === "propose") ||
    normalizedName === "askuserquestion" ||
    normalizedName === "exitplanmode" ||
    normalizedName === "task" ||
    normalizedName === "agent" ||
    normalizedName.includes("request_user_input")
  ) {
    return false;
  }

  return true;
}

interface ActivityCategory {
  key: string;
  items: CompactToolActivityItem[];
}

function getActivityCategory(item: CompactToolActivityItem): string {
  if (item.kind === "worker_event") return "worker-event";
  if (item.kind === "thought") return "thought";
  const name = item.name.toLowerCase();
  if (name === "bash") {
    if (isPureTakodeSendCommand(item.input.command)) return "worker-send";
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

function uniqueActivityItems(items: CompactToolActivityItem[]): CompactToolActivityItem[] {
  const seenIds = new Set<string>();
  return items.filter((item) => {
    if (!item.id) return true;
    const identity = `${item.kind ?? "tool"}:${item.id}`;
    if (seenIds.has(identity)) return false;
    seenIds.add(identity);
    return true;
  });
}

function conciseValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized;
}

function workerEventCount(item: CompactToolActivityItem): number {
  const count = item.input.eventCount;
  return typeof count === "number" && count > 0 ? count : 1;
}

function describeCategory(category: ActivityCategory): string {
  const count = category.items.length;
  const first = category.items[0];
  if (category.key === "worker-event") {
    return summarizeWorkerEventActivity(category.items.reduce((sum, item) => sum + workerEventCount(item), 0));
  }
  if (category.key === "thought") return "Thought";
  if (category.key === "worker-send") return count === 1 ? "Sent a message" : `Sent ${count} messages`;
  if (category.key === "read") return count === 1 ? "Read file" : "Read files";
  if (category.key === "command") return count === 1 ? "Ran command" : `Ran ${count} commands`;
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
  if (category.key === "tool:Skill") {
    const skill = count === 1 ? conciseValue(first.input.skill) : null;
    return skill ? `Used ${skill} skill` : "Used skills";
  }
  return `Used ${getToolLabel(first.name)}`;
}

/** Categories that keep their own wording instead of joining the tool-call count. */
function isSemanticCategory(key: string): boolean {
  return key === "worker-event" || key === "worker-send" || key === "thought";
}

function lowercaseFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
}

function joinSummaryParts(parts: string[]): string {
  return parts.map((part, index) => (index === 0 ? part : lowercaseFirst(part))).join(", ");
}

function formatToolCallCount(count: number): string {
  return `${count} tool call${count === 1 ? "" : "s"}`;
}

function shouldUseToolCountFallback(
  toolCallCount: number,
  toolCategoryCount: number,
  descriptiveSummary: string,
): boolean {
  return (
    toolCallCount > MAX_DESCRIPTIVE_TOOL_CALLS ||
    toolCategoryCount > MAX_DESCRIPTIVE_TOOL_CATEGORIES ||
    descriptiveSummary.length > MAX_DESCRIPTIVE_SUMMARY_LENGTH
  );
}

/** Build the short, human-readable label shown for a collapsed run of tools. */
export function summarizeToolActivity(items: CompactToolActivityItem[]): string {
  const uniqueItems = uniqueActivityItems(items);
  const categories = groupActivity(uniqueItems);
  const descriptiveSummary = joinSummaryParts(categories.map(describeCategory));
  const ordinaryToolCategories = categories.filter((category) => !isSemanticCategory(category.key));
  const ordinaryToolCallCount = ordinaryToolCategories.reduce((count, category) => count + category.items.length, 0);
  const ordinaryToolCategoryCount = ordinaryToolCategories.length;

  if (!shouldUseToolCountFallback(ordinaryToolCallCount, ordinaryToolCategoryCount, descriptiveSummary)) {
    return descriptiveSummary;
  }

  let includedToolCount = false;
  const countSummaryParts = categories.flatMap((category) => {
    if (isSemanticCategory(category.key)) return [describeCategory(category)];
    if (includedToolCount) return [];
    includedToolCount = true;
    return [formatToolCallCount(ordinaryToolCallCount)];
  });
  return joinSummaryParts(countSummaryParts);
}

interface LineStatus {
  running: boolean;
  failed: boolean;
  durationSeconds?: number;
}

function itemKey(item: CompactToolActivityItem): string {
  return `${item.kind ?? "tool"}:${item.id}`;
}

/** Short type label shown before each line, like the worker-preview card. */
function lineLabel(item: CompactToolActivityItem): string {
  if (item.kind === "thought") return "Thought";
  if (item.kind === "worker_event") return "Event";
  if (getActivityCategory(item) === "worker-send") return "Send";
  if (item.name.startsWith("mcp:") || item.name.startsWith("mcp__") || item.name === "mcp_tool_call") return "MCP";
  return item.name;
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface LineFilePath {
  path: string;
  /** Further files changed by the same call (multi-file Codex edits). */
  moreCount: number;
}

/** The file a file tool touches; rendered with the diff viewer's long-path rule. */
function lineFilePath(item: CompactToolActivityItem): LineFilePath | null {
  if (item.kind === "thought" || item.kind === "worker_event") return null;
  const { name, input } = item;
  if (name === "Write" || name === "Edit") {
    const changedPaths = getDistinctChangeFilePaths(input);
    if (changedPaths.length > 1) return { path: changedPaths[0], moreCount: changedPaths.length - 1 };
  }
  let path: string | null = null;
  if (name === "Read" || name === "Write" || name === "Edit") path = nonBlank(input.file_path);
  else if (name === "NotebookEdit") path = nonBlank(input.notebook_path);
  else if (name === "view_image") path = nonBlank(input.path);
  return path ? { path, moreCount: 0 } : null;
}

/** One-line description of an activity, as its own chip header would show it. */
function linePreview(item: CompactToolActivityItem): string {
  if (item.kind === "thought") return nonBlank(item.input.text) ?? "Thinking";
  if (item.kind === "worker_event") {
    return nonBlank(item.input.summary) ?? summarizeWorkerEventActivity(workerEventCount(item));
  }
  // A worker send's command carries the message body, so never preview it.
  if (getActivityCategory(item) === "worker-send") return nonBlank(item.input.description) ?? "Sent a message";
  const filePath = lineFilePath(item);
  if (filePath) return filePath.moreCount > 0 ? `${filePath.path} +${filePath.moreCount} more` : filePath.path;
  const preview = getPreview(item.name, item.input);
  if (preview) return preview;
  // Repeating the line label ("Skill Skill") says nothing; a friendlier tool name still helps.
  const toolLabel = getToolLabel(item.name);
  return toolLabel === lineLabel(item) ? "" : toolLabel;
}

/** Prose previews (descriptions, thoughts) read better in the UI font than in mono. */
function isProsePreview(item: CompactToolActivityItem): boolean {
  if (item.kind === "thought" || item.kind === "worker_event") return true;
  if (getActivityCategory(item) === "worker-send") return true;
  return item.name === "Bash" && nonBlank(item.input.description) != null;
}

/** Read every line's status once per group from the session's result maps. */
function useLineStatuses(sessionId: string | undefined, items: CompactToolActivityItem[]): Map<string, LineStatus> {
  const results = useStore((state) => (sessionId ? state.toolResults.get(sessionId) : undefined));
  const startTimes = useStore((state) => (sessionId ? state.toolStartTimestamps.get(sessionId) : undefined));
  return useMemo(() => {
    const statuses = new Map<string, LineStatus>();
    for (const item of items) {
      if (item.kind === "thought") {
        statuses.set(itemKey(item), { running: item.input.streaming === true, failed: false });
        continue;
      }
      if (item.kind === "worker_event") {
        statuses.set(itemKey(item), { running: false, failed: false });
        continue;
      }
      const result = item.resultOverride ?? results?.get(item.id);
      statuses.set(itemKey(item), {
        running: !result && startTimes?.has(item.id) === true,
        failed: result?.is_error === true,
        durationSeconds: result?.duration_seconds,
      });
    }
    return statuses;
  }, [items, results, startTimes]);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function PulseDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cc-primary" />;
}

/**
 * A run of agent activity between two pieces of agent text.
 *
 * One activity is a single light line. Several form a card: a summary heading
 * over a rolling window of the newest activities, with older ones folded into
 * "+N earlier". Once later content follows the group it is no longer active,
 * and collapsed it shows only its heading. Expanding fills the older lines in
 * above without moving the newest ones, and every line opens in place to its
 * own details.
 */
export function CompactToolActivity({
  items,
  sessionId,
  containedMessageIds = [],
  renderDetails,
  defaultExpanded = false,
  active = true,
}: {
  items: CompactToolActivityItem[];
  sessionId?: string;
  containedMessageIds?: string[];
  /** Details for one opened line; rendered with no header of its own. */
  renderDetails: (item: CompactToolActivityItem) => ReactNode;
  defaultExpanded?: boolean;
  /** Whether nothing has followed the group yet; only an active group keeps its rolling window while collapsed. */
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const expandTargetId = useStore((state) => (sessionId ? state.expandAllInTurn.get(sessionId) : undefined));
  const uniqueItems = useMemo(() => uniqueActivityItems(items), [items]);
  const summary = useMemo(() => summarizeToolActivity(uniqueItems), [uniqueItems]);
  const statuses = useLineStatuses(sessionId, uniqueItems);

  useEffect(() => {
    if (!expandTargetId || !containedMessageIds.includes(expandTargetId)) return;
    setExpanded(true);
    if (uniqueItems.length === 1) setOpenKeys(new Set([itemKey(uniqueItems[0])]));
  }, [containedMessageIds, expandTargetId, uniqueItems]);

  if (uniqueItems.length === 0) return null;

  const toggleLine = (key: string) =>
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const isCard = uniqueItems.length > 1;
  const windowSize = active ? ROLLING_WINDOW_SIZE : 0;
  const hiddenCount = expanded || !isCard ? 0 : Math.max(0, uniqueItems.length - windowSize);
  const lines = uniqueItems.slice(hiddenCount).map((item) => {
    const key = itemKey(item);
    return (
      <ActivityLine
        key={key}
        item={item}
        sessionId={sessionId}
        status={statuses.get(key)}
        open={openKeys.has(key)}
        onToggle={() => toggleLine(key)}
        renderDetails={renderDetails}
      />
    );
  });

  if (!isCard) return <div data-testid="compact-tool-activity">{lines}</div>;

  return (
    <div
      data-testid="compact-tool-activity"
      className="w-full max-w-2xl rounded-lg border border-cc-border/70 bg-cc-card/60 px-1.5 py-1"
    >
      <ActivityHeading
        items={uniqueItems}
        statuses={statuses}
        summary={summary}
        collapsible={uniqueItems.length > windowSize}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
      />
      {hiddenCount > 0 && active && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-5 w-full items-center rounded pl-[27px] text-left text-[11px] text-cc-muted/70 hover:text-cc-fg cursor-pointer"
          data-testid="compact-tool-activity-earlier"
        >
          +{hiddenCount} earlier
        </button>
      )}
      {lines}
    </div>
  );
}

function ActivityHeading({
  items,
  statuses,
  summary,
  collapsible,
  expanded,
  onToggle,
}: {
  items: CompactToolActivityItem[];
  statuses: Map<string, LineStatus>;
  summary: string;
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lineStatuses = items.map((item) => statuses.get(itemKey(item)));
  const running = lineStatuses.some((status) => status?.running);
  const failedCount = lineStatuses.filter((status) => status?.failed).length;
  const knownDurations = lineStatuses.flatMap((status) =>
    status?.durationSeconds != null ? [status.durationSeconds] : [],
  );
  const totalSeconds = knownDurations.reduce((sum, seconds) => sum + seconds, 0);
  // Per-type counts only add information when the group mixes activity types.
  const typeCounts = new Map<string, number>();
  for (const item of items) typeCounts.set(lineLabel(item), (typeCounts.get(lineLabel(item)) ?? 0) + 1);
  const itemKindLabel = items.some((item) => item.kind === "worker_event") ? "activity items" : "tool calls";

  const content = (
    <>
      {collapsible ? <Chevron open={expanded} /> : <span className="w-3 shrink-0" />}
      {running && <PulseDot />}
      <span className="min-w-0 truncate text-cc-fg/85">{summary}</span>
      <span className="flex-1" />
      {failedCount > 0 && <span className="shrink-0 text-[10px] text-cc-error">{failedCount} failed</span>}
      {typeCounts.size > 1 && (
        <span className="hidden shrink-0 gap-2 font-mono-code text-[10px] text-cc-muted sm:flex">
          {[...typeCounts].map(([label, count]) => (
            <span key={label}>
              {count} {label}
            </span>
          ))}
        </span>
      )}
      {!running && knownDurations.length > 0 && (
        <span className="shrink-0 text-[10px] tabular-nums text-cc-muted">{formatDuration(totalSeconds)}</span>
      )}
    </>
  );
  const className = "flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-[12px] text-cc-muted";
  if (!collapsible) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} all ${items.length} ${itemKindLabel}: ${summary}`}
      className={`${className} hover:bg-cc-hover/50 cursor-pointer`}
    >
      {content}
    </button>
  );
}

function ActivityLine({
  item,
  sessionId,
  status,
  open,
  onToggle,
  renderDetails,
}: {
  item: CompactToolActivityItem;
  sessionId?: string;
  status?: LineStatus;
  open: boolean;
  onToggle: () => void;
  renderDetails: (item: CompactToolActivityItem) => ReactNode;
}) {
  const label = lineLabel(item);
  const preview = linePreview(item);
  const filePath = lineFilePath(item);
  const failed = status?.failed === true;
  const running = status?.running === true;
  const isTool = item.kind !== "thought" && item.kind !== "worker_event";
  const previewColor = open ? "text-cc-fg" : "text-cc-muted group-hover:text-cc-fg";
  return (
    <div data-testid="compact-tool-activity-line" data-feed-block-id={item.feedBlockId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${label}: ${preview}`}
        title={preview}
        className={`group flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-[12px] hover:bg-cc-hover/50 cursor-pointer ${open ? "bg-cc-hover/40" : ""}`}
      >
        <span className="text-cc-muted">
          <Chevron open={open} />
        </span>
        {/* Labels stay neutral so only a failed line reads red; the accent color looked red beside it. */}
        <span
          className={`min-w-[2.25rem] shrink-0 font-mono-code text-[11px] ${
            failed ? "text-cc-error" : isTool ? "text-cc-fg/60" : "text-cc-muted"
          }`}
        >
          {label}
        </span>
        {filePath ? (
          <LineFilePathPreview filePath={filePath} className={previewColor} />
        ) : (
          <span
            className={`min-w-0 flex-1 truncate ${isProsePreview(item) ? "" : "font-mono-code text-[11px]"} ${previewColor}`}
          >
            {preview}
          </span>
        )}
        {running && <PulseDot />}
        {/* Live time while running; an opened line also shows its final duration. */}
        {(running || open) && isTool && sessionId && (
          <ToolDurationBadge toolUseId={item.id} sessionId={sessionId} resultOverride={item.resultOverride} />
        )}
        {failed && <span className="shrink-0 text-[10px] text-cc-error">failed</span>}
      </button>
      {open && (
        <div className="mb-1 ml-[22px] mt-1 min-w-0">
          <ToolBlockEmbeddedContext.Provider value>{renderDetails(item)}</ToolBlockEmbeddedContext.Provider>
        </div>
      )}
    </div>
  );
}

/**
 * A file path cut the way the diff viewer's file headers cut it: the last two
 * folders after "...", with the file name kept whole while the folders truncate.
 */
function LineFilePathPreview({ filePath, className }: { filePath: LineFilePath; className: string }) {
  const { dirLabel, baseLabel } = formatFileHeaderPath(filePath.path);
  return (
    <span
      className={`flex min-w-0 flex-1 items-baseline overflow-hidden font-mono-code text-[11px] ${className}`}
      data-testid="compact-tool-activity-path"
    >
      {dirLabel && <span className="min-w-0 truncate opacity-70">{dirLabel}</span>}
      <span className="max-w-[70%] shrink-0 truncate">{baseLabel}</span>
      {filePath.moreCount > 0 && <span className="shrink-0 pl-1.5 opacity-70">+{filePath.moreCount} more</span>}
    </span>
  );
}
