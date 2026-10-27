import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ArtifactMessageMarker, ArtifactVersionContent, PostAttachment } from "../../shared/artifact-library.js";
import {
  destinationLabel,
  draftPartLabel,
  type DraftBlock,
  type DraftDestination,
  type PostPartChanges,
} from "../../shared/draft-posts.js";
import { artifactApi } from "../api/artifacts.js";
import { messageCopyForSlack } from "../utils/slack-copy.js";
import { CopyImageButton } from "./CopyImageButton.js";
import { FullScreenButton, FullScreenPanel } from "./FullScreenPanel.js";

/**
 * A post drafted for the user to send: one card for the message and its replies (a Slack thread),
 * each part with its own Copy for Slack and its attached files, and Copy all in the header. A
 * revision's card marks parts new or edited and lists removed ones, which open to their old text.
 */

export interface PostPartView {
  text: string;
  label: string;
  change?: "edited" | "new";
  attachments: PostAttachment[];
}

/** How a card shows an attachment, and the image source Copy image puts on the clipboard (null: no copy). */
export interface AttachmentRendering {
  render: (attachment: PostAttachment) => ReactNode;
  copySource: (attachment: PostAttachment) => string | null;
}

export function DraftPostCard({
  title,
  destination,
  parts,
  removed = [],
  headerLink,
  renderMarkdown,
  attachments,
  expandable = true,
}: {
  title?: string;
  /** Where the post is to be sent, shown as a link in the header. */
  destination?: DraftDestination;
  parts: PostPartView[];
  /** Parts of the version before that this one dropped, each opening to its old text. */
  removed?: Array<{ label: string; open: () => ReactNode }>;
  /** The post's Library link (version), shown in the header. */
  headerLink?: ReactNode;
  renderMarkdown: (text: string) => ReactNode;
  attachments: AttachmentRendering;
  /** Offers the full-screen view (not inside it). */
  expandable?: boolean;
}) {
  const single = parts.length === 1 && removed.length === 0;
  const partsRef = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  return (
    <>
      <div
        className="my-2 overflow-hidden rounded-xl border border-cc-border bg-cc-card"
        data-markdown-draft=""
        data-testid="draft-post-card"
      >
        {/* Controls, not content: kept out of selections and copies. */}
        <div
          className="flex select-none flex-wrap items-center gap-x-2 border-b border-cc-border bg-cc-hover/40 px-3 py-1.5"
          data-copy-exclude=""
        >
          <PencilIcon />
          {title ? (
            <span className="min-w-0 truncate text-[12px] text-cc-muted">{title}</span>
          ) : (
            <span className="text-[11px] font-medium uppercase tracking-wide text-cc-muted">Draft</span>
          )}
          {destination && <DestinationLink destination={destination} />}
          <span className="ml-auto" />
          {headerLink}
          {expandable && <FullScreenButton onClick={() => setFullScreen(true)} />}
          {single ? (
            <CopyForSlack target={partsRef} primary />
          ) : (
            <CopyForSlack target={partsRef} label="Copy all" testId="draft-post-copy-all" />
          )}
        </div>
        <div ref={partsRef}>
          {parts.map((part, index) => (
            <DraftPostPart
              key={index}
              part={part}
              single={single}
              renderMarkdown={renderMarkdown}
              attachments={attachments}
            />
          ))}
        </div>
        {removed.map((entry, index) => (
          <RemovedPart key={index} label={entry.label} open={entry.open} />
        ))}
      </div>
      {fullScreen && (
        <FullScreenPanel title={title ?? "Draft"} onClose={() => setFullScreen(false)}>
          <div className="mx-auto max-w-3xl">
            <DraftPostCard
              title={title}
              destination={destination}
              parts={parts}
              removed={removed}
              headerLink={headerLink}
              renderMarkdown={renderMarkdown}
              attachments={attachments}
              expandable={false}
            />
          </div>
        </FullScreenPanel>
      )}
    </>
  );
}

function DraftPostPart({
  part,
  single,
  renderMarkdown,
  attachments,
}: {
  part: PostPartView;
  single: boolean;
  renderMarkdown: (text: string) => ReactNode;
  attachments: AttachmentRendering;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className={single ? "" : "border-b border-cc-border/70 last:border-b-0"} data-testid="draft-post-part">
      {!single && (
        <div className="flex select-none items-center gap-2 px-3 pt-2" data-copy-exclude="">
          <span className="text-[12px] font-medium text-cc-muted">{part.label}</span>
          {part.change && (
            <span
              className={`rounded-full px-1.5 py-px text-[11px] ${
                part.change === "new" ? "bg-cc-success/15 text-cc-success" : "bg-cc-primary/15 text-cc-primary"
              }`}
              data-testid="draft-post-change"
            >
              {part.change}
            </span>
          )}
          <span className="ml-auto" />
          <CopyForSlack target={bodyRef} primary />
        </div>
      )}
      <div ref={bodyRef} className={single ? "px-3 py-2.5" : "px-3 pb-2.5 pt-1"}>
        {renderMarkdown(part.text)}
      </div>
      {part.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-2.5" data-copy-exclude="" data-testid="draft-post-attachments">
          {part.attachments.map((attachment) => (
            <div key={attachment.path} className="flex max-w-[16rem] flex-col items-start gap-1">
              {attachments.render(attachment)}
              <CopyImageButton
                src={attachments.copySource(attachment)}
                className="text-[12px] text-cc-primary hover:underline disabled:opacity-50"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemovedPart({ label, open }: { label: string; open: () => ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className="border-t border-dashed border-cc-border px-3 py-1.5"
      data-copy-exclude=""
      data-testid="draft-post-removed"
    >
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-expanded={shown}
        className="text-[12px] text-cc-muted hover:text-cc-fg pointer-coarse:min-h-8"
      >
        {label} removed {shown ? "▾" : "›"}
      </button>
      {shown && <div className="opacity-70">{open()}</div>}
    </div>
  );
}

function CopyForSlack({
  target,
  primary = false,
  label = "Copy for Slack",
  testId = "markdown-draft-copy",
}: {
  target: React.RefObject<HTMLDivElement | null>;
  primary?: boolean;
  label?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (!target.current) return;
        messageCopyForSlack(target.current)
          .write()
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(console.error);
      }}
      className={
        primary
          ? "inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-cc-primary px-2.5 text-[12px] font-medium text-white hover:bg-cc-primary-hover pointer-coarse:min-h-9 pointer-coarse:px-3"
          : "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[12px] text-cc-primary hover:bg-cc-hover pointer-coarse:min-h-9"
      }
      data-testid={testId}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Opens the place the post is to be sent (a Slack thread, a pull request) in a new tab or the app. */
function DestinationLink({ destination }: { destination: DraftDestination }) {
  const label = destinationLabel(destination);
  return (
    <a
      href={destination.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Post in ${label}: ${destination.url}`}
      // On a phone it takes its own line under the title; on wider screens it follows the title.
      className="order-last -mx-1 inline-flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-0.5 rounded-md px-1 text-[12px] text-cc-primary hover:bg-cc-hover pointer-coarse:min-h-8 sm:order-none sm:mx-0 sm:w-auto sm:max-w-[55%] sm:shrink"
      data-testid="draft-post-destination"
    >
      <span className="truncate">Post in {label}</span>
      <span aria-hidden="true" className="shrink-0">
        ↗
      </span>
    </a>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-3.5 w-3.5 text-cc-muted">
      <path d="M3 13l1-3.5L11 2.5a1.4 1.4 0 012 2L6 11.5 3 13z" strokeLinejoin="round" />
    </svg>
  );
}

/** A post version's parts as the card shows them, marked by how they changed from the version before. */
export function postPartsOf(
  content: Extract<ArtifactVersionContent, { kind: "post" }>,
  changes?: PostPartChanges,
): PostPartView[] {
  return content.parts.map((text, index) => ({
    text,
    label: draftPartLabel(index),
    ...(changeOf(changes, index) ? { change: changeOf(changes, index) } : {}),
    attachments: content.attachments?.[index] ?? [],
  }));
}

function changeOf(changes: PostPartChanges | undefined, index: number): "edited" | "new" | undefined {
  const change = changes?.parts[index];
  return change === "edited" || change === "new" ? change : undefined;
}

/** Labels of the parts of the previous version that a version dropped. */
export function removedPartLabels(changes: PostPartChanges | undefined): Array<{ index: number; label: string }> {
  return (changes?.removed ?? []).map((index) => ({ index, label: draftPartLabel(index) }));
}

const versionContents = new Map<string, Promise<ArtifactVersionContent>>();

/** A saved version's content, fetched once per page: versions never change. */
export function useVersionContent(marker: { id: string; version: number } | undefined, wanted: boolean) {
  const [content, setContent] = useState<ArtifactVersionContent | null>(null);
  const key = marker && wanted ? `${marker.id}:${marker.version}` : null;
  useEffect(() => {
    if (!key || !marker) return;
    let cancelled = false;
    let request = versionContents.get(key);
    if (!request) {
      request = artifactApi.versionContent(marker.id, marker.version);
      versionContents.set(key, request);
      request.catch(() => versionContents.delete(key));
    }
    request.then((value) => !cancelled && setContent(value)).catch(() => {});
    return () => {
      cancelled = true;
    };
    // `key` covers the marker's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return content;
}

/**
 * The parts a message's draft blocks show. A full post shows its blocks, marked from the saved
 * version when there is one. A revision that names parts (`part: 2`) shows the whole saved version
 * once it is loaded, and until then (or when nothing was saved) the parts it names.
 */
export function feedPostParts(
  blocks: readonly DraftBlock[],
  marker: ArtifactMessageMarker | undefined,
  saved: ArtifactVersionContent | null,
): PostPartView[] {
  const changes = marker?.changes;
  if (blocks.some((block) => block.part)) {
    if (saved?.kind === "post") return postPartsOf(saved, changes);
    return blocks.map((block) => ({
      text: block.body,
      label: block.part ? draftPartLabel(block.part - 1) : "New reply",
      change: block.part ? "edited" : "new",
      attachments: block.attachments.map((path) => ({ path })),
    }));
  }
  const marks = changes && changes.parts.length === blocks.length ? changes : undefined;
  return blocks.map((block, index) => ({
    text: block.body,
    label: draftPartLabel(index),
    ...(changeOf(marks, index) ? { change: changeOf(marks, index) } : {}),
    attachments: block.attachments.map((path) => ({ path })),
  }));
}
