import type { ChatMessage } from "../types.js";

export const NEEDS_INPUT_RESOLUTION_NOTICE_SOURCE_ID = "system:needs-input-resolution";

export interface NeedsInputResolutionNoticeEntryView {
  rawId: string;
  summary: string;
  source: string | null;
}

export interface NeedsInputResolutionNoticeViewModel {
  title: string;
  description: string;
  warning: string;
  entries: NeedsInputResolutionNoticeEntryView[];
  rawContent: string;
}

type NoticeCandidate = Pick<ChatMessage, "agentSource" | "content">;

export function buildNeedsInputResolutionNoticeViewModel(
  message: NoticeCandidate,
): NeedsInputResolutionNoticeViewModel | null {
  if (message.agentSource?.sessionId !== NEEDS_INPUT_RESOLUTION_NOTICE_SOURCE_ID) return null;

  const parsed = parseNeedsInputResolutionNotice(message.content);
  if (!parsed) {
    return {
      title: "Needs-input resolution notice",
      description: "Resolved externally",
      warning: "",
      entries: [],
      rawContent: message.content,
    };
  }

  return {
    title: "Needs-input resolution notice",
    description: describeResolutionNotice(parsed.count, parsed.threadKey),
    warning: parsed.warning,
    entries: parsed.entries,
    rawContent: message.content,
  };
}

interface ParsedNeedsInputResolutionNotice {
  count: number | null;
  threadKey: string | null;
  warning: string;
  entries: NeedsInputResolutionNoticeEntryView[];
}

function parseNeedsInputResolutionNotice(content: string): ParsedNeedsInputResolutionNotice | null {
  const lines = content.split(/\r?\n/).map((line) => line.trimEnd());
  if (lines[0]?.trim() !== "[Needs-input resolution notice]") return null;

  const header = parseResolutionNoticeHeader(lines[1]?.trim() ?? "");
  const entries: NeedsInputResolutionNoticeEntryView[] = [];
  let warning = "";

  for (const line of lines.slice(2)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = parseResolutionNoticeEntry(trimmed);
    if (entry) {
      entries.push(entry);
      continue;
    }
    if (trimmed.includes("takode notify resolve")) warning = trimmed;
  }

  return {
    count: header.count,
    threadKey: header.threadKey,
    warning,
    entries,
  };
}

function parseResolutionNoticeHeader(header: string): { count: number | null; threadKey: string | null } {
  const current = /^Resolved same-session same-thread needs-input \(([^)]+)\): (\d+)(?:[.;]|$)/.exec(header);
  if (current) {
    return { threadKey: current[1], count: Number.parseInt(current[2], 10) };
  }

  const legacy = /^Externally resolved same-session same-thread needs-input notifications \(([^)]+)\): (\d+)\./.exec(
    header,
  );
  if (legacy) {
    return { threadKey: legacy[1], count: Number.parseInt(legacy[2], 10) };
  }

  return { threadKey: null, count: null };
}

function parseResolutionNoticeEntry(line: string): NeedsInputResolutionNoticeEntryView | null {
  const match = /^(n-\d+|\d+)\.\s+(.+?)(?:\s+--\s+(.+?)\.|\s+\((.+?)\)\.)?$/.exec(line);
  if (!match) return null;
  return {
    rawId: match[1],
    summary: match[2].trim() || "(no summary)",
    source: (match[3] ?? match[4] ?? null)?.trim() || null,
  };
}

function describeResolutionNotice(count: number | null, threadKey: string | null): string {
  const countLabel = count === 1 ? "1 resolved externally" : `${count ?? "Some"} resolved externally`;
  return threadKey ? `${countLabel} in ${threadKey}` : countLabel;
}
