import type { TodoMarkdownParts } from "./todo-types.js";

interface TitleBounds {
  start: number;
  end: number;
  afterLine: number;
  eol: string;
}

export function findTodoTitleBounds(markdown: string): TitleBounds | null {
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of markdown.matchAll(pattern)) {
    const line = match[1] ?? "";
    if (!line.trim()) continue;
    const start = match.index ?? 0;
    const eol = match[2] ?? "";
    return { start, end: start + line.length, afterLine: start + line.length + eol.length, eol };
  }
  return null;
}

export function deriveTodoMarkdown(markdown: string): TodoMarkdownParts {
  const bounds = findTodoTitleBounds(markdown);
  if (!bounds) return { titleMarkdown: "" };
  const titleMarkdown = markdown.slice(bounds.start, bounds.end).trim();
  const details = markdown.slice(bounds.afterLine);
  return { titleMarkdown, ...(details.trim() ? { detailsMarkdown: details } : {}) };
}

export function combineLegacyTodoMarkdown(titleMarkdown: string, detailsMarkdown?: string | null): string {
  return detailsMarkdown == null ? titleMarkdown : `${titleMarkdown}\n${detailsMarkdown}`;
}
