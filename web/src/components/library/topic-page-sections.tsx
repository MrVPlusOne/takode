import { type ReactNode, useCallback, useState } from "react";
import { scopedGetItem, scopedSetItem } from "../../utils/scoped-storage.js";

/**
 * Collapsible sections of a topic page. Every section heading folds its section, so a long History
 * can be put away to reach what follows. Each topic remembers which of its sections the user folded
 * or opened, on this device: a section stays as the user left it on that topic and other topics
 * keep their own defaults (open, except the full quest list).
 */

const COLLAPSED_KEY = "cc-topic-collapsed-sections";

/** A `## ` section of the Scribe's page: its heading and its text without the heading line. */
export interface PageSection {
  /** Null for text before the first `## ` heading. */
  title: string | null;
  text: string;
}

/** The page's `## ` sections, in order. */
export function pageSections(body: string): PageSection[] {
  return body
    .split(/\n(?=## )/)
    .map((chunk) => {
      const match = /^## +(.*)$/m.exec(chunk.split("\n")[0]!);
      return match
        ? { title: match[1]!.trim(), text: chunk.slice(chunk.indexOf("\n") + 1 || chunk.length).trim() }
        : { title: null, text: chunk.trim() };
    })
    .filter((section) => section.title !== null || section.text);
}

/** A Status or "Latest …" section, which the page shows before Now. */
export function isLeadingSection(section: PageSection): boolean {
  return section.title !== null && /^(Status|Latest\b.*)$/.test(section.title);
}

type SectionStates = Record<string, Record<string, boolean>>;

function readStates(): SectionStates {
  try {
    const parsed = JSON.parse(scopedGetItem(COLLAPSED_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SectionStates) : {};
  } catch {
    return {};
  }
}

/**
 * Which of a topic's sections are folded. Only choices that differ from a section's default are
 * stored, so the record stays small and a section the user put back as it was carries no entry.
 */
export function useCollapsedSections(topicId: string): {
  isCollapsed: (name: string, byDefault?: boolean) => boolean;
  toggle: (name: string, byDefault?: boolean) => void;
} {
  const [states, setStates] = useState(readStates);
  const own = states[topicId] ?? {};
  const isCollapsed = (name: string, byDefault = false) => own[name.toLowerCase()] ?? byDefault;
  const toggle = useCallback(
    (name: string, byDefault = false) => {
      const key = name.toLowerCase();
      // Re-read, so another open page's choices since this one loaded aren't overwritten.
      const all = readStates();
      const mine = { ...all[topicId] };
      const next = !(mine[key] ?? byDefault);
      if (next === byDefault) delete mine[key];
      else mine[key] = next;
      if (Object.keys(mine).length) all[topicId] = mine;
      else delete all[topicId];
      scopedSetItem(COLLAPSED_KEY, JSON.stringify(all));
      setStates(all);
    },
    [topicId],
  );
  return { isCollapsed, toggle };
}

/**
 * A section with a heading that folds it. `page` headings look like the Scribe's own (`##`);
 * `meta` headings are the small labels of the sections Takode adds (open quests, artifacts, the
 * quest list). `aside` sits at the heading's right, outside the fold button.
 */
export function TopicSection({
  title,
  collapsed,
  onToggle,
  size = "page",
  aside,
  testId,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  size?: "page" | "meta";
  aside?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const heading =
    size === "page"
      ? `mt-3 ${collapsed ? "mb-0" : "mb-2"} text-lg font-bold text-cc-fg`
      : "mb-1 text-[11px] uppercase tracking-wide text-cc-muted";
  const Heading = size === "page" ? "h2" : "h3";
  return (
    <section data-testid={testId} data-collapsed={collapsed || undefined}>
      <div className="flex items-baseline gap-2">
        <Heading className={`min-w-0 flex-1 ${heading}`}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="group inline-flex max-w-full items-center gap-1.5 text-left hover:opacity-80"
            data-testid="topic-section-toggle"
          >
            <span className="min-w-0">{title}</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={`shrink-0 text-cc-muted transition-transform ${size === "page" ? "h-3.5 w-3.5" : "h-3 w-3"} ${
                collapsed ? "-rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </Heading>
        {aside}
      </div>
      {!collapsed && children}
    </section>
  );
}
