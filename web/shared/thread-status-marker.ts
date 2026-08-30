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
  /** Stable full-ID correlation retained when bounded projections shorten messageId. */
  messageIdHash?: string;
  timestamp: number;
  updatedAt: number;
}

export const THREAD_STATUS_MESSAGE_ID_HASH_LENGTH = 32;

/** Deterministic 128-bit non-cryptographic fingerprint for bounded message identity correlation. */
export function threadStatusMessageIdHash(value: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x9e3779b1];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] = Math.imul((hashes[lane]! ^ code ^ (index + lane)) >>> 0, primes[lane]!);
    }
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

const THREAD_STATUS_MARKER_RE = /^\{\[\(Thread (Waiting|Ready): (main|q-\d+) \| ([^\r\n]{1,200})\)\]\}$/;
const THREAD_STATUS_MARKER_LIKE_RE = /^\{\[\(Thread\b/;

export function isThreadStatusMarkerLikeLine(line: string): boolean {
  return THREAD_STATUS_MARKER_LIKE_RE.test(line.trim());
}

export function parseThreadStatusMarkerLine(line: string, lineIndex = 0): ParsedThreadStatusMarker | null {
  const normalizedLine = line.trim();
  const match = THREAD_STATUS_MARKER_RE.exec(normalizedLine);
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
    raw: normalizedLine,
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
