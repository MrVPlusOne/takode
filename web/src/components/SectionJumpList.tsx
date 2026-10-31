/**
 * A long report's list of its sections, shown before its first section (under the title and the
 * opening lines), so a reader sees the shape of the report and can jump to any part. Only reports
 * with several top-level `##` sections get one; the reading surfaces that show it also widen their
 * column for such reports (they match `[data-section-jump-list]`).
 */

/** A report with at least this many `##` sections is long enough to list them. */
export const JUMP_LIST_MIN_SECTIONS = 4;

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
}

/**
 * Remark plugin: inserts the jump list before the first top-level `##` heading when the document
 * has enough of them. The list carries its section titles, read from the same tree that renders
 * the headings, so each entry lines up with the heading it jumps to.
 */
export function remarkSectionJumpList() {
  return (tree: MarkdownNode) => {
    const children = tree.children ?? [];
    const sections = children.filter((node) => node.type === "heading" && node.depth === 2);
    if (sections.length < JUMP_LIST_MIN_SECTIONS) return;
    const list: MarkdownNode = {
      type: "sectionJumpList",
      children: [],
      data: {
        hName: "nav",
        hProperties: { dataSectionJumpList: "", dataSections: JSON.stringify(sections.map(plainText)) },
      },
    };
    children.splice(children.indexOf(sections[0]!), 0, list);
  };
}

/** The jump list itself; entries scroll the report to the matching top-level heading. */
export function SectionJumpList({ sections }: { sections: string[] }) {
  const jump = (target: HTMLElement, index: number) => {
    const body = target.closest(".markdown-body");
    const heading = body?.querySelectorAll(":scope > h2")[index];
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <nav
      aria-label="Sections"
      className="my-3 select-none border-y border-cc-border py-2.5 text-[13.5px]"
      data-section-jump-list=""
      data-copy-exclude=""
    >
      <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-cc-muted">Sections</div>
      <ul className="gap-x-8 sm:columns-2">
        {sections.map((title, index) => (
          <li key={index} className="break-inside-avoid py-0.5">
            <button
              type="button"
              onClick={(event) => jump(event.currentTarget, index)}
              className="cursor-pointer text-left text-cc-primary hover:underline"
            >
              {title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Reads the section titles the plugin attached to the list's element. */
export function jumpListSections(value: unknown): string[] | null {
  return typeof value === "string" ? (JSON.parse(value) as string[]) : null;
}

function plainText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}
