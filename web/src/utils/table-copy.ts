/**
 * Copy formats for a rendered Markdown table. Cells come from the table as rendered, so links and
 * formatting read the way they look on screen.
 *
 * Slack builds its own native table only from tab-separated plain text (as copied from a
 * spreadsheet), at most one per message; it flattens HTML tables into running text.
 */

export type TableRows = string[][];

/** The table's rows as cell text, header row first; whitespace inside a cell collapses to single spaces. */
export function readTableRows(table: HTMLTableElement): TableRows {
  return Array.from(table.rows, (row) =>
    Array.from(row.cells, (cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
  ).filter((row) => row.length > 0);
}

/**
 * The cells a selection covers when it lies within one table, whole cells only; null when it reaches
 * outside a table or stays inside a single cell. A phone's own copy of a table selection loses the tab-separated layout that makes
 * Slack and spreadsheets paste cells.
 */
export function selectedTableRows(range: Range): TableRows | null {
  const start = range.commonAncestorContainer;
  const element = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
  const table = element?.closest("table");
  if (!table) return null;
  const rows = Array.from(table.rows)
    .filter((row) => range.intersectsNode(row))
    .map((row) =>
      Array.from(row.cells)
        .filter((cell) => range.intersectsNode(cell))
        .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
    )
    .filter((row) => row.length > 0);
  // Words picked from inside one cell copy as the browser selected them.
  if (rows.length === 0 || (rows.length === 1 && rows[0]!.length === 1)) return null;
  return rows;
}

/** Tab-separated rows: what spreadsheets paste as cells and Slack turns into its native table. */
export function tableToTsv(rows: TableRows): string {
  return padRows(rows)
    .map((row) => row.join("\t"))
    .join("\n");
}

/** Columns padded to line up in a monospace font, header underlined, for code blocks and terminals. */
export function tableToAlignedText(rows: TableRows): string {
  const padded = padRows(rows);
  if (padded.length === 0) return "";
  const widths = padded[0]!.map((_, column) => Math.max(...padded.map((row) => displayWidth(row[column]!))));
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell + " ".repeat(widths[column]! - displayWidth(cell)))
      .join("  ")
      .trimEnd();
  const [header, ...body] = padded;
  return [line(header!), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n");
}

/** A GitHub-style Markdown pipe table. */
export function tableToMarkdown(rows: TableRows): string {
  const padded = padRows(rows);
  if (padded.length === 0) return "";
  const line = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
  const [header, ...body] = padded;
  return [line(header!), line(header!.map(() => "---")), ...body.map(line)].join("\n");
}

/** A plain HTML table, header row in `<th>` cells. */
export function tableToHtml(rows: TableRows): string {
  const padded = padRows(rows);
  if (padded.length === 0) return "";
  const cells = (row: string[], tag: "th" | "td") => row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("");
  const [header, ...body] = padded;
  return `<table><thead><tr>${cells(header!, "th")}</tr></thead><tbody>${body
    .map((row) => `<tr>${cells(row, "td")}</tr>`)
    .join("")}</tbody></table>`;
}

/** Monospace columns count East Asian wide characters (Chinese, Japanese, Korean, full-width forms) as two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) width += isWide(character.codePointAt(0)!) ? 2 : 1;
  return width;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Every row gets the header's column count, so a short row stays aligned and spreadsheets keep its columns. */
function padRows(rows: TableRows): TableRows {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array<string>(columns - row.length).fill("")]);
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
