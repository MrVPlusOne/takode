import type { DraftDestination, PostPartChanges } from "./draft-posts.js";
/**
 * The artifact library: things agents made for the user (drafts and posts, reports, figures,
 * visuals, guided reviews), saved by the server as they appear in conversations, with revisions of
 * the same thing grouped as versions. Shared by the server, the browser and the `takode artifact`
 * command.
 */

export type ArtifactKind = "post" | "report" | "review" | "visual" | "figure" | "table";

/** In the order the Library's kind tabs show them. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["figure", "visual", "table", "post", "report", "review"];

/** User-facing names of the kinds, singular. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  post: "Post",
  report: "Report",
  review: "Guided review",
  visual: "Visual",
  figure: "Figure",
  table: "Table",
};

/** Plural names, for the Library's kind tabs. */
export const ARTIFACT_KIND_PLURALS: Record<ArtifactKind, string> = {
  post: "Posts",
  report: "Reports",
  review: "Reviews",
  visual: "Visuals",
  figure: "Figures",
  table: "Tables",
};

/** Where a version appeared: a message of a session's conversation. */
export interface ArtifactMessageRef {
  sessionId: string;
  /** Stable history message ID (assistant `message.id`, or the report's ID). */
  messageId: string;
  threadKey: string;
  at: number;
}

export interface ArtifactVersionSummary {
  /** 1-based. */
  n: number;
  at: number;
  /** Bytes of the saved content, or of the file when it was saved. */
  bytes: number;
  /**
   * Whether this version's content is kept. Every version of model-written text is; a figure keeps
   * only its newest version, so older ones are a record of when and where they appeared.
   */
  kept: boolean;
  /** Draft blocks in a post version (a post can be several Slack messages). */
  parts?: number;
  /** Figures shown in the same answer as a post version. */
  figureIds?: string[];
  /** For a post version after the first: how its parts changed from the version before. */
  changes?: PostPartChanges;
  /** For a post version: where it is to be sent. */
  destination?: DraftDestination;
  /**
   * For a post version: the parts (0-based) the user copied, kept on the server so every device
   * shows them as copied. A new version starts with the parts it kept unchanged from a copied one.
   */
  copied?: number[];
  /** The message it first appeared in; later appearances of identical content add no version. */
  source: ArtifactMessageRef;
}

export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** Session space of the session it was made in. */
  space: string;
  sessionId: string;
  threadKey: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  versionCount: number;
  latest: ArtifactVersionSummary;
  /** First characters of the newest version's text, for previews and search results. */
  preview: string;
  /**
   * The start of the newest version's text with its lines kept, for the gallery's text thumbnails
   * (posts, reports, reviews, tables).
   */
  excerpt?: string;
  /**
   * Set when the artifact has a picture thumbnail (figures, visuals): changes with the newest
   * version, so thumbnail URLs carrying it can be cached for good.
   */
  thumb?: string;
}

export interface ArtifactDetail extends ArtifactSummary {
  versions: ArtifactVersionSummary[];
}

/** A version's content: post parts, Markdown (reports, reviews), visual source, or a figure file. */
export type ArtifactVersionContent =
  | {
      kind: "post";
      parts: string[];
      figureIds: string[];
      /** Per part: the files attached to it (`attach:` lines), when any part has some. */
      attachments?: PostAttachment[][];
      /** Where the post is to be sent (`to:`), kept from the version before unless a revision names another. */
      destination?: DraftDestination;
    }
  | {
      kind: "report" | "review";
      markdown: string;
      sourcePath?: string;
      /** A review's walkthrough, read from the message it was published in when that is still there. */
      review?: ArtifactGuidedReview;
    }
  | { kind: "table"; markdown: string }
  | { kind: "visual"; source: string }
  | { kind: "figure"; path: string; fileUrl: string | null };

/** A file attached to a post's part: its path, and the Library figure keeping it when it is an image. */
export interface PostAttachment {
  path: string;
  figureId?: string;
}

/** What opens a guided review's walkthrough: its message, where answers go, and the review itself. */
export interface ArtifactGuidedReview {
  messageId: string;
  /** The session the review was published in; answers go back to it. */
  sessionId: string;
  threadKey: string;
  questId?: string;
  meta: import("./guided-review.js").GuidedReviewMeta;
}

/** Library list filters; all optional. */
export interface ArtifactListQuery {
  space?: string;
  kind?: ArtifactKind;
  /** Only artifacts changed at or after this time (epoch ms). */
  since?: number;
  starred?: boolean;
  query?: string;
  sessionId?: string;
  /** Only artifacts made in these tabs (quest threads), such as a topic's quests. */
  threadKeys?: string[];
  /**
   * Only artifacts of these sessions (a leader and its workers): made in one of them, or shown in
   * one of their messages.
   */
  sessionIds?: string[];
  limit?: number;
  offset?: number;
}

export interface ArtifactListResponse {
  artifacts: ArtifactSummary[];
  total: number;
  /** How many artifacts each kind has under the same query without its kind, for the kind tabs. */
  kinds: Partial<Record<ArtifactKind, number>>;
  spaces: string[];
}

/**
 * How a message refers to an artifact version, sent with messages to browsers. A superseded
 * version's content is replaced in the message by a collapsed placeholder fence (see
 * `ARTIFACT_PLACEHOLDER_LANGUAGE`); a current one keeps its content and gets a footer line.
 */
export interface ArtifactMessageMarker {
  id: string;
  kind: ArtifactKind;
  title: string;
  version: number;
  versionCount: number;
  /** On a current post version: how its parts changed from the version before (new, edited, removed). */
  changes?: PostPartChanges;
  /** On a post version: where it is to be sent. */
  destination?: DraftDestination;
  /** On a post version: the parts (0-based) the user copied. */
  copied?: number[];
  /** On a collapsed version: a later message shows this same version again. */
  repeated?: boolean;
}

/** Fence language of the placeholder that stands in for a superseded version's content. */
export const ARTIFACT_PLACEHOLDER_LANGUAGE = "takode-artifact";

export function formatArtifactPlaceholder(marker: ArtifactMessageMarker): string {
  return `\`\`\`${ARTIFACT_PLACEHOLDER_LANGUAGE}\n${JSON.stringify(marker)}\n\`\`\``;
}

export function parseArtifactPlaceholder(body: string): ArtifactMessageMarker | null {
  try {
    const value = JSON.parse(body) as Partial<ArtifactMessageMarker>;
    if (typeof value.id !== "string" || typeof value.title !== "string") return null;
    if (!ARTIFACT_KINDS.includes(value.kind as ArtifactKind)) return null;
    if (!Number.isInteger(value.version) || !Number.isInteger(value.versionCount)) return null;
    return value as ArtifactMessageMarker;
  } catch {
    return null;
  }
}

/** URL of an artifact's thumbnail picture; `thumb` (from the summary) makes it cacheable for good. */
export function artifactThumbUrl(artifact: { id: string; thumb?: string }, theme: "dark" | "light"): string | null {
  if (!artifact.thumb) return null;
  return `/api/artifacts/${encodeURIComponent(artifact.id)}/thumb?v=${artifact.thumb}&theme=${theme}`;
}

/** Short ID shown to people and used in links: the first 8 characters, unique in practice. */
export function shortArtifactId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Takode link to an artifact: `[title](artifact:<id>)`, or `[title](artifact:<id>:v<n>)` for one
 * version. The ID may be a unique prefix of at least 4 characters.
 */
export function formatArtifactLink(title: string, id: string, version?: number): string {
  const label = title.replace(/[[\]\\]/g, (char) => `\\${char}`);
  return `[${label}](artifact:${shortArtifactId(id)}${version ? `:v${version}` : ""})`;
}

export function parseArtifactLinkHref(href: string | undefined | null): { id: string; version?: number } | null {
  const match = /^artifact:([0-9a-f-]{4,36})(?::v(\d+))?$/i.exec(href?.trim() ?? "");
  if (!match) return null;
  return { id: match[1].toLowerCase(), ...(match[2] ? { version: Number(match[2]) } : {}) };
}
