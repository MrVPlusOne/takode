import type {
  ArtifactDetail,
  ArtifactListResponse,
  ArtifactSummary,
  ArtifactVersionContent,
} from "../shared/artifact-library.js";
import { ARTIFACT_KIND_LABELS, ARTIFACT_KINDS, formatArtifactLink } from "../shared/artifact-library.js";
import { parseActivityTime } from "./takode-activity.js";
import { apiGet, apiPatch, apiPost, assertKnownFlags, err, formatRelativeTime, parseFlags } from "./takode-core.js";

export const ARTIFACT_HELP = `Usage: takode artifact <list|show|rename|merge> ...

The artifact library: drafts and posts, reports, figures, visuals, tables and guided reviews saved
from conversations, with revisions grouped as versions. Takode saves them by itself; name a draft
with a "title: <name>" line and a "---" line at its start so its revisions group under that name.
Each artifact is printed as a ready-to-paste link, [title](artifact:<id>); add :v<n> after the ID
to link one version.

  takode artifact list [--kind <kind>] [--space <name>|all] [--since <time>] [--query <text>] [--starred] [--limit N] [--json]
      Newest first. Default space: your session's. Kinds: ${ARTIFACT_KINDS.join(", ")}.
  takode artifact show <id> [--version N] [--json]
      An artifact's versions and the content of the newest (or the given) version.
  takode artifact rename <id> <title>
  takode artifact merge <id> --into <id>
      Make one artifact's versions versions of another, for revisions saved separately.

<id> is the short ID in the link (or any unique prefix).`;

const LIST_FLAGS = new Set(["kind", "space", "since", "query", "starred", "limit", "json"]);

/** `takode artifact ...` */
export async function handleArtifact(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "list":
      return listArtifacts(base, rest);
    case "show":
      return showArtifact(base, rest);
    case "rename": {
      const [id, ...titleWords] = rest.filter((arg) => !arg.startsWith("--"));
      const title = titleWords.join(" ").trim();
      if (!id || !title) err("Usage: takode artifact rename <id> <title>");
      const detail = (await apiPatch(base, `/artifacts/${encodeURIComponent(id)}`, { title })) as ArtifactDetail;
      console.log(`Renamed ${shortId(detail.id)} to "${detail.title}".`);
      return;
    }
    case "merge": {
      const flags = parseFlags(rest);
      const id = rest[0];
      if (!id || id.startsWith("--") || typeof flags.into !== "string")
        err("Usage: takode artifact merge <id> --into <id>");
      const detail = (await apiPost(base, `/artifacts/${encodeURIComponent(id)}/merge`, {
        into: flags.into,
      })) as ArtifactDetail;
      console.log(`Merged into ${shortId(detail.id)} "${detail.title}": ${detail.versionCount} versions.`);
      return;
    }
    default:
      console.log(ARTIFACT_HELP);
      if (subcommand) process.exit(1);
  }
}

async function listArtifacts(base: string, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  assertKnownFlags(flags, LIST_FLAGS, ARTIFACT_HELP);
  const params = new URLSearchParams();
  if (typeof flags.kind === "string") params.set("kind", flags.kind);
  if (typeof flags.space === "string") params.set("space", flags.space);
  if (typeof flags.since === "string") params.set("since", String(parseActivityTime(flags.since, Date.now())));
  if (typeof flags.query === "string") params.set("q", flags.query);
  if (flags.starred === true) params.set("starred", "1");
  params.set("limit", typeof flags.limit === "string" ? flags.limit : "30");
  const response = (await apiGet(base, `/artifacts?${params}`, {
    auth: "optional",
  })) as ArtifactListResponse & {
    space?: string | null;
  };
  if (flags.json === true) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  console.log(formatArtifactList(response));
}

export function formatArtifactList(response: ArtifactListResponse & { space?: string | null }): string {
  const scope = response.space ? `space ${response.space}` : "all spaces";
  if (response.artifacts.length === 0) return `No artifacts (${scope}).`;
  const lines = [`${response.total} artifact${response.total === 1 ? "" : "s"} (${scope}), newest first:`];
  for (const artifact of response.artifacts) lines.push(formatArtifactRow(artifact));
  if (response.total > response.artifacts.length)
    lines.push(`… ${response.total - response.artifacts.length} more (--limit)`);
  return lines.join("\n");
}

function formatArtifactRow(artifact: ArtifactSummary): string {
  const version = artifact.versionCount > 1 ? ` v${artifact.versionCount}` : "";
  const star = artifact.starred ? " ★" : "";
  return `  ${ARTIFACT_KIND_LABELS[artifact.kind]}${version}  ${formatArtifactLink(artifact.title, artifact.id)}${star}  · ${artifact.threadKey} · ${formatRelativeTime(artifact.updatedAt)}`;
}

async function showArtifact(base: string, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const id = args[0];
  if (!id || id.startsWith("--")) err("Usage: takode artifact show <id> [--version N] [--json]");
  const detail = (await apiGet(base, `/artifacts/${encodeURIComponent(id)}`, {
    auth: "optional",
  })) as ArtifactDetail;
  const n = typeof flags.version === "string" ? Number(flags.version) : detail.latest.n;
  const version = detail.versions.find((candidate) => candidate.n === n);
  if (!version) err(`No version ${flags.version} (this artifact has ${detail.versionCount}).`);
  const content = version.kept
    ? ((await apiGet(base, `/artifacts/${encodeURIComponent(detail.id)}/versions/${n}`, {
        auth: "optional",
      })) as ArtifactVersionContent)
    : null;
  if (flags.json === true) {
    console.log(JSON.stringify({ ...detail, shown: n, content }, null, 2));
    return;
  }
  const lines = [
    `${ARTIFACT_KIND_LABELS[detail.kind]}  ${formatArtifactLink(detail.title, detail.id)}  · space ${detail.space} · ${detail.threadKey}`,
    `Versions: ${detail.versions
      .map((candidate) => `v${candidate.n} ${formatRelativeTime(candidate.at)}${candidate.kept ? "" : " (not kept)"}`)
      .join(", ")}`,
    `Showing v${n} (thread ${version.source.threadKey}; this version: ${formatArtifactLink(detail.title, detail.id, n)}):`,
    "",
    formatContent(content, version.kept),
  ];
  console.log(lines.join("\n"));
}

function formatContent(content: ArtifactVersionContent | null, kept: boolean): string {
  if (!content) return kept ? "(no content)" : "(only the newest version of a figure is kept)";
  switch (content.kind) {
    case "post":
      return content.parts
        .map((part, index) =>
          content.parts.length > 1 ? `--- part ${index + 1} of ${content.parts.length} ---\n${part}` : part,
        )
        .join("\n\n");
    case "report":
    case "review":
    case "table":
      return content.markdown;
    case "visual":
      return content.source;
    case "figure":
      return `Figure file: ${content.path}`;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
