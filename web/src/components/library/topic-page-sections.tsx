import type { ReactNode } from "react";
import { useRememberedFolds } from "../../utils/remembered-folds.js";

/**
 * Collapsible sections of a topic page. Every section heading folds its section, so a long History
 * can be put away to reach what follows. Each topic remembers which of its sections the user folded
 * or opened, on this device: a section stays as the user left it on that topic and other topics
 * keep their own defaults (open, except the full quest list).
 */

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

/**
 * Which of a topic's sections are folded, as remembered folds (`topic:<topicId>:<section>`), so a
 * choice made on one page holds on every other open page of the topic too.
 */
export function useCollapsedSections(topicId: string): {
  isCollapsed: (name: string, byDefault?: boolean) => boolean;
  toggle: (name: string, byDefault?: boolean) => void;
} {
  const folds = useRememberedFolds();
  const id = (name: string) => `topic:${topicId}:${name.toLowerCase()}`;
  return {
    isCollapsed: (name, byDefault = false) => folds.isFolded(id(name), byDefault),
    toggle: (name, byDefault = false) => folds.toggle(id(name), byDefault),
  };
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
