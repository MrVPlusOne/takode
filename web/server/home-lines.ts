/**
 * One line of news per thread for a leader's Home: what is newest in each quest or thread, from
 * what agents already wrote. A quest's line is its latest phase note's summary (a finished quest's,
 * its debrief summary); a thread's is the leader's latest answer there.
 */
import type { QuestmasterTask } from "./quest-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { normalizeThreadKey } from "../shared/leader-projection.js";

export interface HomeLine {
  text: string;
  at: number;
  source: "note" | "debrief" | "answer" | "scribe";
}

const MAX_LINE = 160;

/** A quest's newest news, or null when nothing was written yet. */
export function questHomeLine(quest: QuestmasterTask): HomeLine | null {
  const record = quest as QuestmasterTask & { debriefTldr?: string; debrief?: string; completedAt?: number };
  if (record.status === "done") {
    const text = firstLine(record.debriefTldr ?? record.debrief ?? "");
    if (text) return { text, at: record.completedAt ?? 0, source: "debrief" };
  }
  const notes = (record.feedback ?? []).filter((entry) => entry.author === "agent" && entry.kind === "phase_summary");
  const note = notes.at(-1);
  const text = note ? firstLine(note.tldr ?? note.text) : "";
  return text ? { text, at: note!.ts, source: "note" } : null;
}

/** The leader's latest answer in each of `threadKeys`, as a line. */
export function threadHomeLines(
  history: readonly BrowserIncomingMessage[],
  threadKeys: readonly string[],
): Record<string, HomeLine> {
  const wanted = new Set(threadKeys.map(normalizeThreadKey));
  const lines: Record<string, HomeLine> = {};
  for (let index = history.length - 1; index >= 0 && Object.keys(lines).length < wanted.size; index--) {
    const message = history[index]!;
    if (message.type !== "assistant" || message.leaderThreadRole !== "answer" || !message.threadKey) continue;
    const key = normalizeThreadKey(message.threadKey);
    if (!wanted.has(key) || lines[key]) continue;
    const text = firstLine(
      (message.message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n"),
    );
    if (text)
      lines[key] = { text, at: typeof message.timestamp === "number" ? message.timestamp : 0, source: "answer" };
  }
  return lines;
}

/** The first line of prose, without list markers, emphasis or link targets, kept short. */
export function firstLine(markdown: string): string {
  const line =
    markdown
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate && !/^(#|```|\|)/.test(candidate)) ?? "";
  const plain = line
    .replace(/^[-*+]\s+|^\d+\.\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
  return plain.length > MAX_LINE ? `${plain.slice(0, MAX_LINE - 1).trimEnd()}…` : plain;
}
