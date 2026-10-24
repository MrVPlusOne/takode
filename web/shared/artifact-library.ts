/**
 * The artifact library: things agents made for the user (drafts and posts, reports, figures,
 * visuals, guided reviews), saved by the server as they appear in conversations, with revisions of
 * the same thing grouped as versions. Shared by the server, the browser and the `takode artifact`
 * command.
 */

export type ArtifactKind = "post" | "report" | "review" | "visual" | "figure";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["post", "report", "review", "visual", "figure"];

/** User-facing names of the kinds, singular. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  post: "Post",
  report: "Report",
  review: "Guided review",
  visual: "Visual",
  figure: "Figure",
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
}

export interface ArtifactDetail extends ArtifactSummary {
  versions: ArtifactVersionSummary[];
}

/** A version's content: post parts, Markdown (reports, reviews), visual source, or a figure file. */
export type ArtifactVersionContent =
  | { kind: "post"; parts: string[]; figureIds: string[] }
  | { kind: "report" | "review"; markdown: string; sourcePath?: string }
  | { kind: "visual"; source: string }
  | { kind: "figure"; path: string; fileUrl: string | null };

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
  limit?: number;
  offset?: number;
}

export interface ArtifactListResponse {
  artifacts: ArtifactSummary[];
  total: number;
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
  /**
   * On a collapsed post version: which of its messages (0-based) were replaced, when the others
   * are still current and stay shown in the conversation.
   */
  parts?: number[];
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

/**
 * A draft may start with a `title:` line and a `---` line, naming it so its revisions group as
 * versions of one post. The header is not part of the message: it is neither shown nor copied.
 */
export function parseDraftHeader(text: string): {
  title?: string;
  body: string;
} {
  const match = /^title:[ \t]*(.+?)[ \t]*\r?\n---[ \t]*(?:\r?\n|$)/i.exec(text);
  if (!match) return { body: text };
  return { title: match[1], body: text.slice(match[0].length) };
}
