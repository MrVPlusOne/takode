/**
 * Drafts an agent writes for the user to send, as ```draft blocks. A post is one message and its
 * replies: a block with a `title:` header starts it, and untitled blocks after it (or blocks with the
 * same title) add its replies. A block may name the part it replaces (`part: 2`), so a revision can
 * repeat only the parts that changed, and may end with `attach: <path>` lines, files sent with that
 * part (as a Slack message carries images). A `to:` header names where the post is to be sent (a
 * Slack channel or thread, a pull request), shown on the card as a link. The server reads posts into
 * the Library and the feed shows each post as one card, both with these rules.
 */

/** One ```draft block: its header, the text to send and the files attached under it. */
export interface DraftBlock {
  title?: string;
  /** The part this block replaces, 1-based (1 is the message, 2 its first reply). */
  part?: number;
  /** Where the post is to be sent (`to:`). */
  destination?: DraftDestination;
  body: string;
  attachments: string[];
}

/** Where a post is to be sent: a link that opens the place, and its name when the agent knew it. */
export interface DraftDestination {
  url: string;
  label?: string;
}

/** A fenced code block at the top level of Markdown text: `[start, end)` covers its fence lines. */
export interface MarkdownFence {
  start: number;
  end: number;
  language: string;
  body: string;
}

/** How one post's parts changed from its previous version. */
export interface PostPartChanges {
  /** Per part of the new version. */
  parts: Array<"same" | "edited" | "new">;
  /** Parts of the previous version that are gone (0-based indexes into it). */
  removed: number[];
}

const HEADER = /^((?:(?:title|part|to):[^\n]*\r?\n)+)---[ \t]*(?:\r?\n|$)/i;
const ATTACH = /^attach:[ \t]*(.+?)[ \t]*$/i;

/**
 * A draft block's header (`title:`, `part:` and `to:` lines ended by `---`), its text and its
 * `attach:` lines.
 */
export function parseDraftBlock(text: string): DraftBlock {
  let body = text;
  let title: string | undefined;
  let part: number | undefined;
  let destination: DraftDestination | undefined;
  const header = HEADER.exec(text);
  if (header) {
    for (const line of header[1].split(/\r?\n/)) {
      const [, key, value] = /^(title|part|to):[ \t]*(.*?)[ \t]*$/i.exec(line) ?? [];
      if (key?.toLowerCase() === "title" && value) title = value;
      if (key?.toLowerCase() === "part" && /^[1-9]\d*$/.test(value ?? "")) part = Number(value);
      if (key?.toLowerCase() === "to") destination = parseDestination(value ?? "") ?? destination;
    }
    body = text.slice(header[0].length);
  }
  const lines = body.split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  const attachments: string[] = [];
  while (end > 0) {
    const match = ATTACH.exec(lines[end - 1]);
    if (!match) break;
    attachments.unshift(cleanAttachmentPath(match[1]));
    end -= 1;
    while (end > 0 && !lines[end - 1].trim()) end -= 1;
  }
  return {
    ...(title ? { title } : {}),
    ...(part ? { part } : {}),
    ...(destination ? { destination } : {}),
    body: attachments.length ? lines.slice(0, end).join("\n") : body,
    attachments,
  };
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;

/**
 * The fenced code blocks of Markdown text, outermost only (a fence inside another is part of its
 * body). An unclosed fence runs to the end of the text and is left out.
 */
export function scanFences(text: string): { fences: MarkdownFence[]; unclosedFrom: number | null } {
  const fences: MarkdownFence[] = [];
  let offset = 0;
  let open: { marker: string; language: string; start: number; bodyStart: number } | null = null;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        fences.push({
          start: open.start,
          end: lineEnd,
          language: open.language,
          body: text.slice(open.bodyStart, Math.max(open.bodyStart, lineStart - 1)),
        });
        open = null;
      }
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening && !(opening[2][0] === "`" && opening[3].includes("`"))) {
      open = { marker: opening[2], language: opening[3].toLowerCase(), start: lineStart, bodyStart: offset };
    }
  }
  return { fences, unclosedFrom: open?.start ?? null };
}

/**
 * Splits draft blocks, in order, into posts: a block starts a new post when there is none yet or
 * its title differs from the current post's; an untitled block, or one with the same title, joins it.
 */
export function groupDraftPosts<T extends { title?: string }>(blocks: readonly T[]): T[][] {
  const posts: T[][] = [];
  let title: string | undefined;
  for (const block of blocks) {
    const current = posts.at(-1);
    if (!current || (block.title && block.title !== title)) {
      posts.push([block]);
      title = block.title;
    } else {
      current.push(block);
    }
  }
  return posts;
}

/**
 * A post's parts after a revision. Blocks that name a part replace it (a number past the end adds
 * one), and the other parts carry over; blocks without a number are added at the end. Without any
 * numbered block, the blocks are the whole post: that is how parts are inserted, dropped or reordered.
 */
export function revisePostParts<T>(
  previous: readonly T[] | undefined,
  blocks: ReadonlyArray<{ part?: number; value: T }>,
): T[] {
  if (!previous || !blocks.some((block) => block.part)) return blocks.map((block) => block.value);
  const parts = [...previous];
  for (const block of blocks) {
    if (block.part && block.part <= parts.length) parts[block.part - 1] = block.value;
    else parts.push(block.value);
  }
  return parts;
}

/**
 * How each part of a post's new version relates to the previous version. Unchanged parts are
 * matched in order (longest common sequence); between two matches, parts pair up in order as
 * edited, and the rest are new or removed.
 */
export function comparePostParts(previous: readonly string[], next: readonly string[]): PostPartChanges {
  const rows = previous.length;
  const cols = next.length;
  const lcs = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] = previous[i] === next[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: PostPartChanges["parts"] = [];
  const removed: number[] = [];
  let gapOld: number[] = [];
  let gapNew: number[] = [];
  const closeGap = () => {
    gapNew.forEach((index, position) => {
      parts[index] = position < gapOld.length ? "edited" : "new";
    });
    removed.push(...gapOld.slice(gapNew.length));
    gapOld = [];
    gapNew = [];
  };
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && previous[i] === next[j]) {
      closeGap();
      parts[j] = "same";
      i += 1;
      j += 1;
    } else if (j < cols && (i >= rows || lcs[i][j + 1] >= lcs[i + 1][j])) {
      gapNew.push(j++);
    } else {
      gapOld.push(i++);
    }
  }
  closeGap();
  return { parts, removed };
}

/** A post's part as the user knows it: the message, then numbered replies. */
export function draftPartLabel(index: number): string {
  return index === 0 ? "Message" : `Reply ${index}`;
}

function cleanAttachmentPath(raw: string): string {
  return raw
    .replace(/^<(.+)>$/, "$1")
    .replace(/^file:(\/\/)?/i, "")
    .trim();
}

/** Fence language of a post's draft blocks gathered into one place for rendering. */
export const DRAFT_POST_LANGUAGE = "takode-post";

/** A post's draft blocks as the feed renders them: one card where its first block was. */
export interface GroupedDraftPost {
  title?: string;
  blocks: DraftBlock[];
}

/**
 * Markdown with each post's draft blocks gathered into one `takode-post` fence (holding the post as
 * JSON on one line) where its first block was; its later blocks are taken out. Text between them
 * stays where it was. Text without draft blocks comes back unchanged.
 */
export function groupDraftPostsInMarkdown(text: string): string {
  if (!/```+[ \t]*draft|~~~+[ \t]*draft/i.test(text)) return text;
  const drafts = scanFences(text)
    .fences.filter((fence) => fence.language === "draft")
    .map((fence) => ({ fence, ...parseDraftBlock(fence.body) }));
  if (drafts.length === 0) return text;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const blocks of groupDraftPosts(drafts)) {
    const post: GroupedDraftPost = {
      ...(blocks[0]!.title ? { title: blocks[0]!.title } : {}),
      blocks: blocks.map(({ fence: _fence, ...block }) => block),
    };
    blocks.forEach(({ fence }, index) =>
      edits.push({
        start: fence.start,
        end: fence.end,
        replacement: index === 0 ? `\`\`\`${DRAFT_POST_LANGUAGE}\n${JSON.stringify(post)}\n\`\`\`` : "",
      }),
    );
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

/** The post a `takode-post` fence holds, or null when it is not one. */
export function parseGroupedDraftPost(body: string): GroupedDraftPost | null {
  try {
    const value = JSON.parse(body) as GroupedDraftPost;
    return Array.isArray(value?.blocks) ? value : null;
  } catch {
    return null;
  }
}

/** Files attached to the draft blocks of Markdown text, so the feed shows them in their card only. */
export function draftAttachmentPaths(text: string): Set<string> {
  if (!/attach:/i.test(text)) return new Set();
  return new Set(
    scanFences(text)
      .fences.filter((fence) => fence.language === "draft")
      .flatMap((fence) => parseDraftBlock(fence.body).attachments),
  );
}

/**
 * A `to:` value: a web link, either bare or as `[name](url)`, optionally followed by its name. Only
 * http(s) links are taken, so a draft can't make the card open anything else.
 */
export function parseDestination(value: string): DraftDestination | null {
  const markdown = /^\[([^\]]+)\]\(<?([^)\s>]+)>?\)$/.exec(value.trim());
  const bare = /^<?(\S+?)>?(?:[ \t]+(.+))?$/.exec(value.trim());
  const url = markdown?.[2] ?? bare?.[1];
  const label = (markdown?.[1] ?? bare?.[2])?.replace(/^\(|\)$/g, "").trim();
  if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) return null;
  return { url, ...(label ? { label } : {}) };
}

/**
 * How the card names a destination: the name the agent gave, else what the link shows (a Slack
 * thread or channel, a pull request or issue), else the site.
 */
export function destinationLabel(destination: DraftDestination): string {
  if (destination.label) return destination.label;
  let url: URL;
  try {
    url = new URL(destination.url);
  } catch {
    return destination.url;
  }
  if (/(^|\.)slack\.com$/i.test(url.hostname)) {
    return /\/p\d+/.test(url.pathname) || url.searchParams.has("thread_ts") ? "Slack thread" : "Slack channel";
  }
  const github = /^\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/.exec(url.pathname);
  if (/(^|\.)github\.com$/i.test(url.hostname) && github) {
    return `${github[2] === "pull" ? "PR" : "Issue"} #${github[3]} in ${github[1]}`;
  }
  return url.hostname.replace(/^www\./, "");
}

/** A post's destination: the first block that names one. */
export function postDestination(
  blocks: ReadonlyArray<{ destination?: DraftDestination }>,
): DraftDestination | undefined {
  return blocks.find((block) => block.destination)?.destination;
}
