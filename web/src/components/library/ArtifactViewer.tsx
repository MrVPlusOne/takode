import { useCallback, useEffect, useState } from "react";
import { ARTIFACT_KIND_LABELS, type ArtifactDetail } from "../../../shared/artifact-library.js";
import { artifactApi } from "../../api/artifacts.js";
import { useStore } from "../../store.js";
import { useLibraryNav } from "../../utils/library-nav.js";
import { navigateToSessionMessageId } from "../../utils/routing.js";
import { closeSecondaryPage } from "../../utils/secondary-view.js";
import { ArtifactVersionLoader, StarIcon } from "../ArtifactInline.js";
import { MarkdownContent } from "../MarkdownContent.js";

/**
 * One artifact in the Library: its newest version (or the one stepped to), each version's date,
 * a star, renaming, and a link to the message the version came from.
 */
export function ArtifactViewer({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const requestedVersion = useLibraryNav((state) => state.version);
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

  const update = useCallback(
    (next: ArtifactDetail) => {
      setDetail(next);
      onChanged();
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
        <SourceLink sessionId={source.sessionId} messageId={source.messageId} threadKey={source.threadKey} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {version.kept ? (
          <ArtifactVersionLoader
            id={detail.id}
            version={version.n}
            renderMarkdown={(markdown) => <MarkdownContent text={markdown} sessionId={source.sessionId} />}
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

function ViewerFrame({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="artifact-viewer">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1 px-3 pt-2 text-[13px] text-cc-muted hover:text-cc-fg md:hidden"
      >
        ‹ Library
      </button>
      {children}
    </div>
  );
}

/** "From #2957 Daily Leader · q-2713": opens the conversation at the message the version came from. */
function SourceLink({ sessionId, messageId, threadKey }: { sessionId: string; messageId: string; threadKey: string }) {
  const session = useStore((state) => state.sdkSessions.find((candidate) => candidate.sessionId === sessionId));
  const name = session ? `#${session.sessionNum ?? ""} ${session.name ?? ""}`.trim() : "its conversation";
  return (
    <button
      type="button"
      onClick={() => {
        closeSecondaryPage();
        navigateToSessionMessageId(sessionId, messageId, { threadKey });
      }}
      className="mt-1.5 text-left text-[13px] text-cc-primary hover:underline"
    >
      From {name}
      {threadKey && threadKey !== "main" ? ` · ${threadKey}` : ""} ›
    </button>
  );
}
