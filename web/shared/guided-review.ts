/**
 * Guided reviews: an agent's review of a git range, written as a map that points at line ranges
 * of the real diff and never pastes code. Takode renders the code from the diff itself and
 * refuses a map that does not account for every changed line. Shared by the CLI (map input),
 * the server (validation and the Markdown version agents read) and the browser (code snippets).
 */

/** decide: only the user can choose; check: worth a careful look; checked: looked risky, verified fine. */
export type GuidedReviewTier = "decide" | "check" | "checked";

export const GUIDED_REVIEW_TIERS: readonly GuidedReviewTier[] = ["decide", "check", "checked"];

export interface GuidedReviewCodeRef {
  /** Repository-relative path as git prints it (the new path of a renamed file). */
  path: string;
  /** Inclusive new-file line range; omitted means every changed line of the file. */
  lines?: [number, number];
  /** Set by the server when publishing: the diff text this reference shows, cut from the change. */
  snippet?: string;
}

export interface GuidedReviewStop {
  tier: GuidedReviewTier;
  title: string;
  /** Markdown: why this matters, or for checked stops, the evidence. */
  note: string;
  /** Required for decide stops: the question only the user can answer. */
  question?: string;
  /** Required for decide stops: two to four short answers. */
  answers?: string[];
  code: GuidedReviewCodeRef[];
}

export interface GuidedReviewSummary {
  title: string;
  /** Markdown summary of the files' changed lines not shown in a stop. */
  text: string;
  paths: string[];
}

export interface GuidedReviewMap {
  title: string;
  /** Markdown: what the change does and what the review found. */
  overview: string;
  stops: GuidedReviewStop[];
  summaries: GuidedReviewSummary[];
}

/** What the agent writes: the map plus the git range it reviews. */
export interface GuidedReviewMapInput extends GuidedReviewMap {
  base: string;
  head: string;
}

export interface GuidedReviewRange {
  /** Repository folder name, for display. */
  repo: string;
  base: string;
  head: string;
  commits: { sha: string; subject: string }[];
  /** Checkouts on the publishing machine holding the commits, tried in order for the full diff. */
  repoPaths?: string[];
  /** The machine those checkouts are on; absent for the server's own machine. */
  hostId?: string;
}

export interface GuidedReviewStats {
  files: number;
  additions: number;
  deletions: number;
  /** Changed lines shown in stops; the rest are summarized. */
  linesInStops: number;
  /** Changed lines in stops of each tier. */
  linesByTier: Record<GuidedReviewTier, number>;
}

/** Stored on the published report message; the diff itself is fetched on demand. */
export interface GuidedReviewMeta {
  reviewId: string;
  map: GuidedReviewMap;
  range: GuidedReviewRange;
  stats: GuidedReviewStats;
}

export const MAX_GUIDED_REVIEW_DIFF_BYTES = 8 * 1024 * 1024;
/** Reviews keep only their stops' code; this caps it so history stays light. */
export const MAX_GUIDED_REVIEW_SNIPPET_BYTES = 1024 * 1024;
export const MAX_GUIDED_REVIEW_STOPS = 40;
const MAX_ANSWER_CHARS = 40;

export interface DiffLine {
  kind: "add" | "del" | "context";
  text: string;
  oldNo?: number;
  newNo?: number;
  /** For deleted lines: the new-file line they sit before, so ranges can claim them. */
  anchor?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** Text after the second `@@`, such as the enclosing function. */
  section: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  /** git's header lines (`diff --git`, `---`, `+++` and the like), kept to rebuild snippets. */
  header: string[];
  hunks: DiffHunk[];
}

/** Parse `git diff` output into files with numbered lines. */
export function parseGuidedReviewDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      file = { path: match?.[2] ?? line.slice(11), oldPath: match?.[1], header: [line], hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunkMatch) {
      oldNo = Number(hunkMatch[1]);
      newNo = Number(hunkMatch[2]);
      hunk = { oldStart: oldNo, newStart: newNo, section: hunkMatch[3], lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      file.header.push(line);
      if (line.startsWith("+++ b/")) file.path = line.slice(6);
      else if (line.startsWith("--- a/")) file.oldPath = line.slice(6);
      continue;
    }
    const kind = line[0];
    if (kind === "+") hunk.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    else if (kind === "-") hunk.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, anchor: newNo });
    else if (kind === " ") hunk.lines.push({ kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    // "\ No newline at end of file" and the trailing empty line carry no numbered content.
  }
  for (const entry of files) if (entry.oldPath === entry.path) delete entry.oldPath;
  return files;
}

/** Read and check the JSON an agent wrote; throws one readable error listing every problem. */
export function parseGuidedReviewMapInput(value: unknown): GuidedReviewMapInput {
  const problems: string[] = [];
  const record = isRecord(value) ? value : {};
  if (!isRecord(value)) problems.push("The map must be a JSON object.");
  const text = (key: string, where: string, from: Record<string, unknown>, required = true): string => {
    const field = from[key];
    if (typeof field === "string" && field.trim()) return field.trim();
    if (required || field !== undefined) problems.push(`${where}: "${key}" must be a non-empty string.`);
    return "";
  };
  const base = text("base", "map", record);
  const head = text("head", "map", record);
  const title = text("title", "map", record);
  const overview = text("overview", "map", record);
  const stops: GuidedReviewStop[] = [];
  const rawStops = Array.isArray(record.stops) ? record.stops : [];
  if (!Array.isArray(record.stops)) problems.push(`map: "stops" must be an array (it may be empty).`);
  if (rawStops.length > MAX_GUIDED_REVIEW_STOPS) problems.push(`map: at most ${MAX_GUIDED_REVIEW_STOPS} stops.`);
  rawStops.forEach((raw, index) => {
    const where = `stop ${index + 1}`;
    const stop = isRecord(raw) ? raw : {};
    const tier = stop.tier as GuidedReviewTier;
    if (!GUIDED_REVIEW_TIERS.includes(tier)) problems.push(`${where}: "tier" must be decide, check or checked.`);
    const parsed: GuidedReviewStop = {
      tier,
      title: text("title", where, stop),
      note: text("note", where, stop),
      code: parseCodeRefs(stop.code, where, problems),
    };
    if (tier === "decide") {
      parsed.question = text("question", where, stop);
      const answers = stop.answers;
      if (
        !Array.isArray(answers) ||
        answers.length < 2 ||
        answers.length > 4 ||
        answers.some((answer) => typeof answer !== "string" || !answer.trim() || answer.length > MAX_ANSWER_CHARS)
      ) {
        problems.push(
          `${where}: a decide stop needs "answers": 2 to 4 strings of at most ${MAX_ANSWER_CHARS} characters.`,
        );
      } else parsed.answers = answers.map((answer: string) => answer.trim());
    }
    if (!parsed.code.length && Array.isArray(stop.code)) problems.push(`${where}: "code" needs at least one entry.`);
    stops.push(parsed);
  });
  const summaries: GuidedReviewSummary[] = [];
  const rawSummaries = Array.isArray(record.summaries) ? record.summaries : [];
  if (!Array.isArray(record.summaries)) problems.push(`map: "summaries" must be an array (it may be empty).`);
  rawSummaries.forEach((raw, index) => {
    const where = `summary ${index + 1}`;
    const summary = isRecord(raw) ? raw : {};
    const paths = Array.isArray(summary.paths) ? summary.paths : [];
    if (!paths.length || paths.some((path) => typeof path !== "string" || !path.trim())) {
      problems.push(`${where}: "paths" must be a non-empty array of file paths.`);
    }
    summaries.push({
      title: text("title", where, summary),
      text: text("text", where, summary),
      paths: paths.filter((path): path is string => typeof path === "string").map((path) => path.trim()),
    });
  });
  if (problems.length) throw new Error(`The review map has problems:\n- ${problems.join("\n- ")}`);
  return { base, head, title, overview, stops, summaries };
}

/**
 * Check that the map accounts for every changed line exactly once: each added or deleted line
 * sits in exactly one stop, or in a file listed by exactly one summary. Returns the problems
 * (empty when the map is complete) and the line counts the review view shows.
 */
export function checkGuidedReviewCoverage(
  map: GuidedReviewMap,
  files: DiffFile[],
): { problems: string[]; stats: GuidedReviewStats } {
  const problems: string[] = [];
  const byPath = new Map<string, DiffFile>();
  for (const file of files) {
    byPath.set(file.path, file);
    if (file.oldPath) byPath.set(file.oldPath, file);
  }
  const linesByTier: Record<GuidedReviewTier, number> = { decide: 0, check: 0, checked: 0 };
  /** Which stop claimed each added line, keyed by file then new-file line number. */
  const claimed = new Map<DiffFile, Map<number, number>>();
  const claimedDeletions = new Map<DiffFile, Set<DiffLine>>();
  /** Stops whose ranges reach each removed line, and whether the range contains the line it sits before. */
  const deletionCandidates = new Map<DiffLine, { stopIndex: number; contains: boolean }[]>();
  const mentioned = new Set<DiffFile>();

  map.stops.forEach((stop, stopIndex) => {
    for (const ref of stop.code) {
      const file = byPath.get(ref.path);
      if (!file) {
        problems.push(`stop ${stopIndex + 1} ("${stop.title}"): ${ref.path} is not part of this change.`);
        continue;
      }
      mentioned.add(file);
      const added = claimed.get(file) ?? new Map<number, number>();
      claimed.set(file, added);
      let found = 0;
      const overlaps: number[] = [];
      for (const line of changedLines(file)) {
        if (!refCovers(ref, line)) continue;
        found++;
        if (line.kind === "del") {
          const candidates = deletionCandidates.get(line) ?? [];
          const contains = !ref.lines || (line.anchor! >= ref.lines[0] && line.anchor! <= ref.lines[1]);
          candidates.push({ stopIndex, contains });
          deletionCandidates.set(line, candidates);
          continue;
        }
        const owner = added.get(line.newNo!);
        if (owner !== undefined && owner !== stopIndex) overlaps.push(line.newNo!);
        else if (owner === undefined) {
          added.set(line.newNo!, stopIndex);
          linesByTier[stop.tier]++;
        }
      }
      if (!found) {
        problems.push(
          `stop ${stopIndex + 1} ("${stop.title}"): ${describeRef(ref)} contains no changed lines; point stops at added or removed lines.`,
        );
      }
      if (overlaps.length) {
        const other = map.stops[added.get(overlaps[0])!];
        problems.push(
          `stop ${stopIndex + 1} ("${stop.title}"): ${file.path} lines ${formatRanges(overlaps)} are already in stop "${other.title}"; each line belongs to one stop.`,
        );
      }
    }
  });

  // A removed line belongs to the stop whose range contains the line it sits before; only when
  // none does, to a range ending right above it. Two stops at the same level both claim it.
  const doubleClaims = new Map<string, number[]>();
  for (const file of files) {
    const deleted = new Set<DiffLine>();
    claimedDeletions.set(file, deleted);
    for (const line of changedLines(file)) {
      const candidates = line.kind === "del" ? deletionCandidates.get(line) : undefined;
      if (!candidates) continue;
      const contained = candidates.filter((candidate) => candidate.contains);
      const owners = [...new Set((contained.length ? contained : candidates).map((candidate) => candidate.stopIndex))];
      if (owners.length > 1) {
        const key = `${file.path}\0${owners[0]}\0${owners[1]}`;
        doubleClaims.set(key, [...(doubleClaims.get(key) ?? []), line.anchor!]);
        deleted.add(line);
        continue;
      }
      deleted.add(line);
      linesByTier[map.stops[owners[0]].tier]++;
    }
  }
  for (const [key, anchors] of doubleClaims) {
    const [path, first, second] = key.split("\0");
    problems.push(
      `${path}: removed lines before line ${formatRanges(anchors)} are in stops "${map.stops[Number(first)].title}" and "${map.stops[Number(second)].title}"; each line belongs to one stop.`,
    );
  }

  const summarizedBy = new Map<DiffFile, number>();
  map.summaries.forEach((summary, index) => {
    for (const path of summary.paths) {
      const file = byPath.get(path);
      if (!file) {
        problems.push(`summary ${index + 1} ("${summary.title}"): ${path} is not part of this change.`);
        continue;
      }
      const earlier = summarizedBy.get(file);
      if (earlier !== undefined && earlier !== index) {
        problems.push(
          `summary ${index + 1} ("${summary.title}"): ${path} is already in summary "${map.summaries[earlier].title}"; list each file in one summary.`,
        );
        continue;
      }
      summarizedBy.set(file, index);
      mentioned.add(file);
    }
  });

  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const added = claimed.get(file);
    const deleted = claimedDeletions.get(file);
    const uncoveredAdded: number[] = [];
    let uncoveredDeleted = 0;
    let changed = 0;
    for (const line of changedLines(file)) {
      changed++;
      if (line.kind === "add") additions++;
      else deletions++;
      if (summarizedBy.has(file)) continue;
      if (line.kind === "add" && !added?.has(line.newNo!)) uncoveredAdded.push(line.newNo!);
      if (line.kind === "del" && !deleted?.has(line)) uncoveredDeleted++;
    }
    if (!changed && !mentioned.has(file)) {
      problems.push(
        `${file.path} changed without line changes (binary, rename or mode); list it in a stop or a summary.`,
      );
    }
    if (uncoveredAdded.length || uncoveredDeleted) {
      const parts = [
        ...(uncoveredAdded.length ? [`added lines ${formatRanges(uncoveredAdded)}`] : []),
        ...(uncoveredDeleted ? [`${uncoveredDeleted} removed line${uncoveredDeleted === 1 ? "" : "s"}`] : []),
      ];
      problems.push(`${file.path}: ${parts.join(" and ")} are in no stop; add the file to a summary or a stop.`);
    }
  }
  const linesInStops = linesByTier.decide + linesByTier.check + linesByTier.checked;
  return { problems, stats: { files: files.length, additions, deletions, linesInStops, linesByTier } };
}

/**
 * The part of a file's diff a code reference points at, as unified diff text the diff viewer
 * renders: changed lines in the range, with the context lines between them. Hunks are rebuilt
 * with correct headers so line numbers stay true.
 */
export function guidedReviewSnippet(file: DiffFile, ref: GuidedReviewCodeRef): string {
  const out = [...file.header];
  for (const hunk of file.hunks) {
    const kept = hunk.lines.filter((line) => !ref.lines || inRange(ref.lines, line));
    if (!kept.length) continue;
    const oldStart = kept.find((line) => line.oldNo !== undefined)?.oldNo ?? 0;
    const newStart = kept.find((line) => line.newNo !== undefined)?.newNo ?? 0;
    const oldCount = kept.filter((line) => line.kind !== "add").length;
    const newCount = kept.filter((line) => line.kind !== "del").length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunk.section}`);
    for (const line of kept) out.push(`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);
  }
  return `${out.join("\n")}\n`;
}

/**
 * The map with each stop's code cut from the change, which is all of the diff a published review
 * keeps; the full change is read from git when asked for. Throws when the stops show too much.
 */
export function withGuidedReviewSnippets(map: GuidedReviewMap, files: DiffFile[]): GuidedReviewMap {
  let bytes = 0;
  const stops = map.stops.map((stop) => ({
    ...stop,
    code: stop.code.map((ref) => {
      const file = files.find((entry) => entry.path === ref.path || entry.oldPath === ref.path);
      const snippet = file ? guidedReviewSnippet(file, ref) : "";
      bytes += new TextEncoder().encode(snippet).byteLength;
      return { ...ref, snippet };
    }),
  }));
  if (bytes > MAX_GUIDED_REVIEW_SNIPPET_BYTES) {
    throw new Error(
      "The stops show more than 1 MiB of code; point them at the lines that matter and summarize the rest.",
    );
  }
  return { ...map, stops };
}

/**
 * Each file's changed lines as new-file ranges, for writing a map: one line per file with its
 * counts, then one per hunk with the range of its changed lines and git's enclosing context.
 */
export function outlineGuidedReviewDiff(files: DiffFile[]): string {
  const lines: string[] = [];
  for (const file of files) {
    const changed = changedLines(file);
    const adds = changed.filter((line) => line.kind === "add").length;
    const renamed = file.oldPath ? ` (renamed from ${file.oldPath})` : "";
    lines.push(`${file.path}${renamed}  +${adds} -${changed.length - adds}`);
    if (!changed.length) lines.push("  no line changes; name the path in a stop or summary");
    for (const hunk of file.hunks) {
      const hunkChanged = hunk.lines.filter((line) => line.kind !== "context");
      if (!hunkChanged.length) continue;
      const numbers = hunkChanged.map((line) => line.newNo ?? line.anchor!);
      const [start, end] = [Math.min(...numbers), Math.max(...numbers)];
      const onlyRemoved = hunkChanged.every((line) => line.kind === "del");
      const range = onlyRemoved ? `removed before ${start}` : start === end ? `${start}` : `${start}-${end}`;
      lines.push(`  ${range}${hunk.section.trim() ? `  ${hunk.section.trim()}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** The Markdown version of a review: what agents read, search finds and Read aloud speaks. */
export function formatGuidedReviewMarkdown(meta: Omit<GuidedReviewMeta, "reviewId">): string {
  const { map, range, stats } = meta;
  const lines = [
    `# Guided review: ${map.title}`,
    "",
    `${range.repo} · ${range.commits.length} commit${range.commits.length === 1 ? "" : "s"} · ${stats.files} files, +${stats.additions} −${stats.deletions}`,
    "",
    map.overview,
  ];
  const section = (title: string, stops: GuidedReviewStop[], line: (stop: GuidedReviewStop, n: number) => string) => {
    if (!stops.length) return;
    lines.push("", `## ${title}`, "", ...stops.map(line));
  };
  const decide = map.stops.filter((stop) => stop.tier === "decide");
  section(
    "Questions for you",
    decide,
    (stop, n) => `${n + 1}. **${stop.question}** ${stop.note} (Answers: ${stop.answers!.join(" / ")})`,
  );
  section(
    "Worth a careful look",
    map.stops.filter((stop) => stop.tier === "check"),
    (stop) => `- **${stop.title}**: ${stop.note}`,
  );
  section(
    "Checked by the agent",
    map.stops.filter((stop) => stop.tier === "checked"),
    (stop) => `- **${stop.title}**: ${stop.note}`,
  );
  if (map.summaries.length) {
    lines.push(
      "",
      "## Summarized",
      "",
      ...map.summaries.map(
        (summary) =>
          `- **${summary.title}** (${summary.paths.length} file${summary.paths.length === 1 ? "" : "s"}): ${summary.text}`,
      ),
    );
  }
  lines.push("", "_Open the review in Takode to see each stop's code and answer the questions._");
  return lines.join("\n");
}

/** Every added or removed line of a file. */
export function changedLines(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "context"));
}

function refCovers(ref: GuidedReviewCodeRef, line: DiffLine): boolean {
  return !ref.lines || inRange(ref.lines, line);
}

/** A removed line belongs to a range when the line it sits before is in it, or it ends the range. */
function inRange([start, end]: [number, number], line: DiffLine): boolean {
  if (line.newNo !== undefined) return line.newNo >= start && line.newNo <= end;
  return line.anchor !== undefined && line.anchor >= start && line.anchor <= end + 1;
}

function parseCodeRefs(value: unknown, where: string, problems: string[]): GuidedReviewCodeRef[] {
  if (!Array.isArray(value)) {
    problems.push(`${where}: "code" must be an array of { "path", "lines": [start, end] }.`);
    return [];
  }
  const refs: GuidedReviewCodeRef[] = [];
  value.forEach((raw, index) => {
    const ref = isRecord(raw) ? raw : {};
    if (typeof ref.path !== "string" || !ref.path.trim()) {
      problems.push(`${where}, code ${index + 1}: "path" must be a repository-relative file path.`);
      return;
    }
    const lines = ref.lines;
    if (lines === undefined) {
      refs.push({ path: ref.path.trim() });
      return;
    }
    if (
      !Array.isArray(lines) ||
      lines.length !== 2 ||
      !lines.every((n) => Number.isInteger(n) && n >= 1) ||
      lines[0] > lines[1]
    ) {
      problems.push(
        `${where}, code ${index + 1}: "lines" must be [start, end], new-file line numbers with start <= end.`,
      );
      return;
    }
    refs.push({ path: ref.path.trim(), lines: [lines[0], lines[1]] });
  });
  return refs;
}

function describeRef(ref: GuidedReviewCodeRef): string {
  if (!ref.lines) return ref.path;
  const [start, end] = ref.lines;
  return start === end ? `${ref.path} line ${start}` : `${ref.path} lines ${start}-${end}`;
}

/** "3-7, 12, 20-21" for a sorted or unsorted list of line numbers. */
function formatRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.length > 8 ? `${parts.slice(0, 8).join(", ")} and ${parts.length - 8} more ranges` : parts.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
