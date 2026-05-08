import { normalizeThreadTarget, type ThreadRouteTarget } from "./thread-routing.js";

export type ThreadStatusKind = "waiting" | "ready";

export interface ParsedThreadStatusMarker {
  kind: ThreadStatusKind;
  label: "Thread Waiting" | "Thread Ready";
  target: ThreadRouteTarget;
  summary: string;
  raw: string;
  lineIndex: number;
}

export interface LeaderThreadStatus {
  kind: ThreadStatusKind;
  label: "Thread Waiting" | "Thread Ready";
  threadKey: string;
  questId?: string;
  summary: string;
  messageId: string;
  timestamp: number;
  updatedAt: number;
}

const THREAD_STATUS_MARKER_RE = /^\{\[\(Thread (Waiting|Ready): (main|q-\d+) \| ([^\r\n]{1,200})\)\]\}$/;
const THREAD_STATUS_MARKER_LIKE_RE = /^\{\[\(Thread\b/;

export function isThreadStatusMarkerLikeLine(line: string): boolean {
  return THREAD_STATUS_MARKER_LIKE_RE.test(line);
}

export function parseThreadStatusMarkerLine(line: string, lineIndex = 0): ParsedThreadStatusMarker | null {
  const match = THREAD_STATUS_MARKER_RE.exec(line);
  if (!match) return null;

  const target = normalizeThreadTarget(match[2]!);
  const rawSummary = match[3]!;
  const summary = rawSummary.trim();
  if (!target || !summary || summary !== rawSummary) return null;

  const label = `Thread ${match[1]}` as ParsedThreadStatusMarker["label"];
  return {
    kind: match[1] === "Waiting" ? "waiting" : "ready",
    label,
    target,
    summary,
    raw: line,
    lineIndex,
  };
}

export function extractThreadStatusMarkersFromText(text: string): {
  text: string;
  markers: ParsedThreadStatusMarker[];
} {
  const markers: ParsedThreadStatusMarker[] = [];
  const keptLines: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const marker = parseThreadStatusMarkerLine(line, index);
    if (marker) {
      markers.push(marker);
      continue;
    }
    keptLines.push(line);
  }

  return {
    text: keptLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd(),
    markers,
  };
}

export function threadStatusKey(threadKey: string | undefined): string {
  return threadKey?.trim().toLowerCase() || "main";
}
