/**
 * Takode link syntax for personal to-dos: `[title](todo:td-12)` for an item and
 * `[short summary](todo:tp-36)` for a proposal to add one.
 *
 * Users never see to-do or proposal IDs, so the visible label stays human-readable.
 * The link opens a preview; a pending proposal can be approved or rejected there.
 */
export interface TodoLinkTarget {
  kind: "item" | "proposal";
  /** `td-12` or `tp-36`. */
  id: string;
}

const TODO_LINK_PATTERN = /^todo:(?:\/\/)?(td|tp)-(\d+)$/i;

/** Return the to-do item or proposal named by a `todo:td-12` / `todo:tp-36` href, or null. */
export function parseTodoLinkHref(href?: string): TodoLinkTarget | null {
  const match = href?.trim().match(TODO_LINK_PATTERN);
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return { kind: prefix === "td" ? "item" : "proposal", id: `${prefix}-${Number.parseInt(match[2]!, 10)}` };
}

/** Build a ready-to-paste Markdown link to an item or proposal, e.g. `[Review PR 98888](todo:tp-36)`. */
export function formatTodoMarkdownLink(id: string, label: string): string {
  const singleLine = label.replace(/\s+/g, " ").trim();
  const safeLabel = singleLine
    ? singleLine.replace(/[\\[\]]/g, "\\$&")
    : id.startsWith("tp-")
      ? "to-do proposal"
      : "to-do";
  return `[${safeLabel}](todo:${id})`;
}
