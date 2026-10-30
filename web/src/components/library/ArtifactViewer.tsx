import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARTIFACT_KIND_LABELS,
  formatArtifactLink,
  shortArtifactId,
  type ArtifactDetail,
} from "../../../shared/artifact-library.js";
import type { QuestTopicMap } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { writeClipboardText } from "../../utils/copy-utils.js";
import { artifactApi } from "../../api/artifacts.js";
import { useStore } from "../../store.js";
import { useLibraryNav } from "../../utils/library-nav.js";
import { openTopicInPanel } from "../../utils/topic-panel.js";
import { navigateToSessionMessageId, sessionMessageIdHash } from "../../utils/routing.js";
import { newWindowClickLabel, openArtifactWindow, openInMainWindow } from "../../utils/artifact-window.js";
import { closeSecondaryPage } from "../../utils/secondary-view.js";
import { ArtifactVersionLoader, StarIcon } from "../ArtifactInline.js";
import { MarkdownContent } from "../MarkdownContent.js";

/**
 * One artifact shown large, in the Library or in a leader's side column: its newest version (or the
 * one linked or stepped to), each version's date, a star, renaming, its short ID with Copy link (for
 * mentioning it to a leader), its topic, and a link to the message the version came from.
 */
export function ArtifactViewer({
  id,
  version: requestedVersion,
  onBack,
  onChanged,
  standalone = false,
}: {
  id: string;
  /** The version to show first; the newest when absent or not kept. */
  version?: number | null;
  /** Back to the Library's gallery; no back link without it (the side column). */
  onBack?: () => void;
  onChanged?: () => void;
  /**
   * In a window of its own: it keeps up with new versions and renames by itself, and links to
   * conversations open in the window it came from.
   */
  standalone?: boolean;
}) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    artifactApi
      .get(id)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setShown(
          requestedVersion && next.versions.some((v) => v.n === requestedVersion) ? requestedVersion : next.latest.n,
        );
      })
      .catch((reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [id, requestedVersion]);

  const latestRef = useRef<number | undefined>(undefined);
  latestRef.current = detail?.latest.n;
  // A window of its own stays current: it reads the artifact again every little while it is visible
  // and when it comes back to the front. Showing the newest version, it moves on to a newer one.
  useEffect(() => {
    if (!standalone) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      artifactApi
        .get(id)
        .then((next) => {
          const previousLatest = latestRef.current;
          setDetail(next);
          setShown((current) => (current === null || current === previousLatest ? next.latest.n : current));
        })
        .catch((reason: Error) => console.warn("[artifact-window] Could not refresh the artifact:", reason.message));
    };
    const timer = setInterval(refresh, STANDALONE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, standalone]);
  useEffect(() => {
    if (standalone && detail) document.title = detail.title;
  }, [standalone, detail]);

  const update = useCallback(
    (next: ArtifactDetail) => {
      setDetail(next);
      onChanged?.();
    },
    [onChanged],
  );

  if (error)
    return <ViewerFrame onBack={onBack}>{<p className="p-4 text-[13px] text-cc-error">{error}</p>}</ViewerFrame>;
  if (!detail || shown === null) {
    return <ViewerFrame onBack={onBack}>{<p className="p-4 text-[13px] text-cc-muted">Loading…</p>}</ViewerFrame>;
  }

  const index = detail.versions.findIndex((version) => version.n === shown);
  const version = detail.versions[index];
  const source = version.source;
  return (
    <ViewerFrame onBack={onBack}>
      <div className="px-4 pb-2 pt-3">
        <div className="flex items-start gap-2">
          {renaming === null ? (
            <h2 className="min-w-0 flex-1 text-[20px] font-semibold leading-tight text-cc-fg">{detail.title}</h2>
          ) : (
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming.trim()) return;
                void artifactApi.rename(detail.id, renaming).then(update);
                setRenaming(null);
              }}
            >
              <input
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                aria-label="Artifact title"
                className="min-w-0 flex-1 rounded-lg border border-cc-border bg-cc-card px-2 py-1 text-base text-cc-fg outline-none focus:border-cc-primary/60"
              />
              <button type="submit" className="rounded-lg px-2 text-[13px] text-cc-primary">
                Save
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => void artifactApi.setStarred(detail.id, !detail.starred).then(update)}
            aria-pressed={detail.starred}
            aria-label={detail.starred ? "Unstar" : "Star"}
            title={detail.starred ? "Unstar" : "Star"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          >
            <StarIcon filled={detail.starred} />
          </button>
          {!standalone && (
            <button
              type="button"
              onClick={() => openArtifactWindow({ id: detail.id, version: version.n })}
              aria-label="Open in new window"
              title={`Open in new window (${newWindowClickLabel()} on an artifact does the same)`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
              data-testid="artifact-open-window"
            >
              <NewWindowIcon />
            </button>
          )}
          {renaming === null && (
            <button
              type="button"
              onClick={() => setRenaming(detail.title)}
              className="h-8 shrink-0 rounded-lg px-2 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            >
              Rename
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-cc-muted">
          {detail.versions.length > 1 && (
            <span
              className="flex items-center rounded-lg border border-cc-border bg-cc-card"
              data-testid="artifact-version-stepper"
            >
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setShown(detail.versions[index - 1].n)}
                aria-label="Older version"
                className="px-2 py-1 disabled:opacity-30"
              >
                ‹
              </button>
              <span className="px-1 text-cc-fg">
                v{version.n} <span className="text-cc-muted">of {detail.versions.length}</span>
              </span>
              <button
                type="button"
                disabled={index === detail.versions.length - 1}
                onClick={() => setShown(detail.versions[index + 1].n)}
                aria-label="Newer version"
                className="px-2 py-1 disabled:opacity-30"
              >
                ›
              </button>
            </span>
          )}
          <span>
            {ARTIFACT_KIND_LABELS[detail.kind]} ·{" "}
            {new Date(version.at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SourceLink
            sessionId={source.sessionId}
            messageId={source.messageId}
            threadKey={source.threadKey}
            standalone={standalone}
          />
          {!standalone && <TopicLink threadKey={detail.threadKey} />}
          <IdChip detail={detail} version={detail.versions.length > 1 ? version.n : undefined} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {version.kept ? (
          <ArtifactVersionLoader
            id={detail.id}
            version={version.n}
            title={detail.title}
            changes={version.changes}
            copied={version.copied}
            onCopied={(parts) =>
              void artifactApi.markCopied(detail.id, version.n, parts).then(update).catch(console.error)
            }
            renderMarkdown={(markdown, options) => (
              <MarkdownContent text={markdown} sessionId={source.sessionId} fileBasePath={options?.fileBasePath} />
            )}
          />
        ) : (
          <p className="py-2 text-[13px] text-cc-muted">
            Only the newest version of a figure is kept. This one appeared {new Date(version.at).toLocaleString()}.
          </p>
        )}
      </div>
    </ViewerFrame>
  );
}

/** How often a window of its own reads its artifact again while visible. */
const STANDALONE_REFRESH_MS = 15_000;

function NewWindowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4" aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 9.5v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V5a1 1 0 011-1h3" strokeLinecap="round" />
    </svg>
  );
}

function ViewerFrame({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col" data-testid="artifact-viewer">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 self-start px-3 pt-2 text-[13px] text-cc-muted hover:text-cc-fg"
        >
          ‹ Library
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * The short ID people mention to a leader ("artifact 0f1e2d3c"), with Copy link for an
 * `[title](artifact:<id>)` link that Takode renders with a preview. With several versions the link
 * names the one shown.
 */
function IdChip({ detail, version }: { detail: ArtifactDetail; version?: number }) {
  const [copied, setCopied] = useState<"id" | "link" | null>(null);
  const copy = (what: "id" | "link") => {
    const text = what === "id" ? shortArtifactId(detail.id) : formatArtifactLink(detail.title, detail.id, version);
    void writeClipboardText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-cc-muted" data-testid="artifact-id">
      <button
        type="button"
        onClick={() => copy("id")}
        title="Copy ID"
        className="rounded-md border border-cc-border bg-cc-card px-1.5 py-0.5 font-mono-code text-[12px] text-cc-fg hover:bg-cc-hover"
      >
        {copied === "id" ? "Copied" : shortArtifactId(detail.id)}
      </button>
      <button
        type="button"
        onClick={() => copy("link")}
        className="rounded-md px-1.5 py-0.5 text-cc-primary hover:bg-cc-hover"
      >
        {copied === "link" ? "Link copied" : "Copy link"}
      </button>
    </span>
  );
}

/**
 * "Topic: T7 run ›" when the artifact's quest is filed under a topic: opens the topic in the panel
 * of the leader whose artifacts are shown (or of the leader on screen).
 */
function TopicLink({ threadKey }: { threadKey: string }) {
  const [topic, setTopic] = useState<QuestTopicMap[string] | null>(null);
  const scopedLeader = useLibraryNav((state) => state.leaderId);
  const leaderOnScreen = useStore((state) => {
    const id = state.currentSessionId;
    return id && state.sdkSessions.some((session) => session.sessionId === id && session.isOrchestrator) ? id : null;
  });
  const leaderId = scopedLeader ?? leaderOnScreen;
  useEffect(() => {
    if (!threadKey.startsWith("q-")) return;
    let cancelled = false;
    topicApi
      .questMap("", [threadKey])
      .then((response) => !cancelled && setTopic(response.map[threadKey] ?? null))
      .catch((error: Error) => console.warn("[library] Could not look up the artifact's topic:", error.message));
    return () => {
      cancelled = true;
    };
  }, [threadKey]);
  if (!topic || !leaderId) return null;
  return (
    <button
      type="button"
      onClick={() => {
        closeSecondaryPage();
        openTopicInPanel(leaderId, topic.id);
      }}
      className="text-left text-[13px] text-cc-primary hover:underline"
    >
      Topic: {topic.name} ›
    </button>
  );
}

/** "From #2957 Daily Leader · q-2713": opens the conversation at the message the version came from. */
function SourceLink({
  sessionId,
  messageId,
  threadKey,
  standalone,
}: {
  sessionId: string;
  messageId: string;
  threadKey: string;
  standalone: boolean;
}) {
  const session = useStore((state) => state.sdkSessions.find((candidate) => candidate.sessionId === sessionId));
  const name = session ? `#${session.sessionNum ?? ""} ${session.name ?? ""}`.trim() : "its conversation";
  return (
    <button
      type="button"
      onClick={() => {
        if (standalone) {
          openInMainWindow(sessionMessageIdHash(sessionId, messageId, threadKey));
          return;
        }
        closeSecondaryPage();
        navigateToSessionMessageId(sessionId, messageId, { threadKey });
      }}
      className="text-left text-[13px] text-cc-primary hover:underline"
    >
      From {name}
      {threadKey && threadKey !== "main" ? ` · ${threadKey}` : ""} ›
    </button>
  );
}
