/**
 * A topic's Now: the open items of a topic, kept by Takode as entries that Scribes add, edit and
 * remove with commands, and shown on the topic page in fixed groups. Each entry records the leader
 * whose work it came from, so a leader's panel shows its own entries first. Shared by the server,
 * the page view and the `takode scribe now` commands.
 */

/**
 * The fixed groups, in the order the page shows them. Nothing here waits on the user: open questions
 * to the user are the needs-input notifications of the topic's quests, which the page shows itself.
 * Follow-ups are optional things the user may do when they choose (set up, send, decide later).
 */
export type NowGroup = "waiting" | "progress" | "next" | "followup" | "try";

export const NOW_GROUPS: readonly NowGroup[] = ["waiting", "progress", "next", "followup", "try"];

const GROUP_LABELS: Record<NowGroup, string> = {
  waiting: "Waiting on",
  progress: "In progress",
  next: "Next",
  followup: "Follow-ups",
  try: "To try",
};

export interface NowEntry {
  /** Short ID, for `takode scribe now edit|remove`. */
  id: string;
  group: NowGroup;
  /** For `waiting`: whom it waits on ("Parsewave", "the leader"). */
  who?: string;
  /** The item's Markdown, with its links. */
  text: string;
  /** The leader whose work it came from; none for items moved from older pages of several leaders. */
  leaderId?: string;
  /** That leader's session number, when the server includes it. */
  leaderNum?: number | null;
  /** Quests the item links to; their events count as news about it. */
  questIds: string[];
  /** When it was added. */
  since: number;
  /** The latest news about it: its adding or editing, or an event of a quest it links. */
  lastNews: number;
  /** A date it is due by, "YYYY-MM-DD". */
  due?: string;
  /** When the user marked it done on the page; such entries stay a day so Undo works. */
  doneAt?: number;
}

/** An entry with no news for this long is shown muted. */
export const NOW_ENTRY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** The heading an entry is shown under: "Next", or "Waiting on Parsewave". */
export function nowGroupLabel(entry: Pick<NowEntry, "group" | "who">): string {
  return entry.group === "waiting" ? `Waiting on ${entry.who || "others"}` : GROUP_LABELS[entry.group];
}

/**
 * The group a page label or command argument names, accepting the labels Scribes wrote before:
 * the retired "Waiting on you" group became Follow-ups.
 */
export function nowGroupOf(label: string): { group: NowGroup; who?: string } | null {
  const text = label.trim().replace(/:$/, "");
  if (/^(you|waiting on you|follow-?ups?)$/i.test(text)) return { group: "followup" };
  const waiting = /^waiting(?: on (.+))?$/i.exec(text);
  if (waiting) return { group: "waiting", ...(waiting[1] ? { who: waiting[1] } : {}) };
  if (/^(progress|in progress)$/i.test(text)) return { group: "progress" };
  if (/^next$/i.test(text)) return { group: "next" };
  if (/^(try|to try)$/i.test(text)) return { group: "try" };
  return null;
}

export function questLinksOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\]\(quest:(q-\d+)[):]/g)].map((match) => match[1]!))];
}

/**
 * For pages written before Now was kept as entries: the page without its "## Now" section, and the
 * section's bullets as entries. Labels that name no group keep their words in the text; checks and
 * things not tried yet go to "To try". Null when the page has no Now section.
 */
export function takeLegacyNow(
  page: string | null,
): { page: string; items: Array<{ group: NowGroup; who?: string; text: string }> } | null {
  if (!page) return null;
  const lines = page.split("\n");
  const start = lines.findIndex((line) => /^##\s+Now\s*$/i.test(line.trim()));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  if (end < 0) end = lines.length;

  const bullets: string[][] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^[-*]\s+/.test(line)) bullets.push([line.replace(/^[-*]\s+/, "")]);
    else if (bullets.length && line.trim()) bullets[bullets.length - 1]!.push(line.trim());
  }
  const items = bullets.map((parts) => {
    const text = parts.join(" ");
    const match = /^\*\*([^*]+?):?\*\*:?\s*/.exec(text);
    if (!match) return { group: "next" as const, text };
    const label = match[1]!.trim();
    const rest = text.slice(match[0].length);
    const known = nowGroupOf(label);
    if (known) return { ...known, text: rest };
    if (/not tried|try|check/i.test(label)) return { group: "try" as const, text: rest };
    return { group: "next" as const, text: `${label}: ${rest}` };
  });
  const kept = [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  return { page: kept.trim(), items };
}
