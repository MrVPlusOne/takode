/**
 * Takode link syntax for personal to-dos: `[title](todo:td-12)`. Users never see to-do IDs, so the
 * visible label stays human-readable. The link opens a preview.
 *
 * Older messages may also hold `todo:tp-36` links to to-do proposals, which Takode no longer has;
 * they still parse so their preview can show the to-do the proposal created.
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

/** Build a ready-to-paste Markdown link to a to-do, e.g. `[Review PR 98888](todo:td-36)`. */
export function formatTodoMarkdownLink(id: string, label: string): string {
  const singleLine = label.replace(/\s+/g, " ").trim();
  const safeLabel = singleLine ? singleLine.replace(/[\\[\]]/g, "\\$&") : "to-do";
  return `[${safeLabel}](todo:${id})`;
}
