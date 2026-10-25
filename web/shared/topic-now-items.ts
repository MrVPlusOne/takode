/**
 * The items of a topic page's Now section, shared by the server (which remembers when each item
 * appeared) and the page view (which shows that date and a done button per item).
 *
 * An item is a top-level bullet under the page's `## Now` heading. It is identified by its label
 * (the bold "Next:" or "Waiting on you:") and the links it carries, so a Scribe can reword an item
 * without it counting as new; an item without links is identified by its words.
 */

export interface NowItem {
  /** Stable identity across rewordings (see above). */
  key: string;
  /** The bullet's Markdown, without the leading "- ". */
  text: string;
  /** Quests the item links to; their events count as news about it. */
  questIds: string[];
}

export interface NowSection {
  /** The page up to and including the Now heading. */
  before: string;
  items: NowItem[];
  /** The rest of the page, from the next heading. */
  after: string;
}

/** What the server reports per Now item when it shows a page. */
export interface NowItemStatus {
  key: string;
  /** When the item first appeared on the page. */
  since: number;
  /** The latest news about it: its appearing or rewording, or an event of a quest it links. */
  lastNews: number;
  /** When the user marked it done on the page, which took it off the page (Undo puts it back). */
  doneAt?: number;
  /** For an item marked done: its text, since it is no longer on the page. */
  text?: string;
}

/** An item with no news for this long is shown muted. */
export const NOW_ITEM_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** The page's Now section split into its items; null when it has none. */
export function nowSectionOf(page: string | null): NowSection | null {
  const section = splitNowSection(page);
  return section?.items.length ? section : null;
}

/**
 * The page with its Now section's items replaced, each a bullet, everything else kept; "Nothing
 * open." when none remain. Null when the page has no Now heading.
 */
export function withNowItems(page: string | null, texts: readonly string[]): string | null {
  const section = splitNowSection(page);
  if (!section) return null;
  const list = texts.length ? texts.map((text) => `- ${text}`).join("\n") : "Nothing open.";
  return [section.before, list, ...(section.after ? ["", section.after] : [])].join("\n");
}

/** The Now section, also when it holds no items; null without a Now heading. */
function splitNowSection(page: string | null): NowSection | null {
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

  const seen = new Map<string, number>();
  const items = bullets.map((parts) => {
    const text = parts.join(" ");
    const base = itemKey(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { key: count > 1 ? `${base}#${count}` : base, text, questIds: questLinks(text) };
  });
  return {
    before: lines.slice(0, start + 1).join("\n"),
    items,
    after: lines.slice(end).join("\n"),
  };
}

function itemKey(text: string): string {
  const label = /^\*\*([^*]+?)\*\*/.exec(text)?.[1]?.replace(/:$/, "").trim().toLowerCase() ?? "";
  const links = [...text.matchAll(/\]\(((?:quest|session|artifact):[^)\s]+)\)/g)].map((match) => match[1]!);
  if (links.length) return `${label}|${[...new Set(links)].sort().join(",")}`;
  const words = text
    .replace(/^\*\*[^*]+?\*\*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
  return `${label}|${words}`;
}

function questLinks(text: string): string[] {
  return [...new Set([...text.matchAll(/\]\(quest:(q-\d+)[):]/g)].map((match) => match[1]!))];
}
