import { useMemo } from "react";
import type { GuidedReviewLineComment } from "../../shared/session-drafts.js";
import {
  lineCommentSpan,
  openLineCommentEditor,
  removeGuidedReviewLineComment,
  saveGuidedReviewLineComment,
  sortLineComments,
  useGuidedReviewState,
  type GuidedReviewTarget,
} from "../guided-review-state.js";
import { intersectRangeWithNodeContents, useTextSelection } from "../hooks/useTextSelection.js";
import { AnnotationEditor } from "./AnnotationEditor.js";
import { ContextMenu } from "./ContextMenu.js";

/**
 * Comments on lines of a guided review's code. The user selects text in a stop's code, as they
 * would select text to comment on in chat, and the comment covers every line the selection
 * touches. Each piece of code is drawn inside an element carrying `data-review-code` with its
 * stop and file, which is how a selection is read back as lines.
 */

type CodeLines = Omit<GuidedReviewLineComment, "id" | "comment">;

/** The attributes that mark one piece of review code, for `codeLinesInRange`. */
export function reviewCodeAttributes(stop: number, path: string) {
  return { "data-review-code": "", "data-review-stop": stop, "data-review-path": path };
}

/**
 * The selection menu and the comment editor for the review open in `container`. Mount once per
 * open review; the lists below open the same editor for an existing comment.
 */
export function LineCommentLayer({ target, container }: { target: GuidedReviewTarget; container: HTMLElement | null }) {
  const { sessionId, meta } = target;
  const containerRef = useMemo(() => ({ current: container }), [container]);
  const selection = useTextSelection(containerRef, (_selection, range, root) =>
    codeLinesInRange(range, root) ? range.cloneRange() : null,
  );
  const draft = useGuidedReviewState((state) => state.drafts[meta.reviewId]);
  const editor = useGuidedReviewState((state) => state.lineCommentEditor);
  const sent = draft?.sentAt !== undefined;
  const comments = draft?.lineComments ?? [];
  const selected =
    selection.isActive && selection.range && container ? codeLinesInRange(selection.range, container) : null;

  const startComment = () => {
    if (!selected) return;
    openLineCommentEditor({
      comment: { id: crypto.randomUUID(), ...selected, comment: "" },
      ...(selection.position ? { position: selection.position } : {}),
    });
    selection.clear();
  };
  const close = () => openLineCommentEditor(null);
  const active = editor?.comment;
  const saved = active ? comments.some((comment) => comment.id === active.id) : false;

  return (
    <>
      {!sent && selected && selection.position && (
        <ContextMenu
          x={selection.position.x}
          y={selection.position.y}
          items={[{ label: `Comment on ${lineCommentSpan(selected)}`, onClick: startComment }]}
          onClose={selection.dismiss}
        />
      )}
      {active && !sent && (
        <AnnotationEditor
          key={active.id}
          sessionId={sessionId}
          threadKey={target.threadKey}
          threadTitle={meta.map.title}
          annotation={{ id: active.id, selectedText: active.code, comment: active.comment }}
          position={editor.position}
          target={<CommentPlace comment={active} full />}
          quotesCode
          // The comments are sent with the review's answers, not by the message box.
          focusComposerOnKeySave={false}
          context={{
            activeId: active.id,
            activeNumber: saved ? comments.findIndex((comment) => comment.id === active.id) + 1 : comments.length + 1,
            selectedText: active.code,
            mainComposerText: draft?.answers[active.stop] ?? "",
            otherAnnotations: comments
              .map((comment, index) => ({
                id: comment.id,
                selectedText: comment.code,
                comment: comment.comment,
                number: index + 1,
              }))
              .filter((comment) => comment.id !== active.id),
          }}
          onSave={(text) => {
            saveGuidedReviewLineComment(sessionId, meta.reviewId, { ...active, comment: text });
            close();
          }}
          onCancel={close}
          onRemove={
            saved
              ? () => {
                  removeGuidedReviewLineComment(sessionId, meta.reviewId, active.id);
                  close();
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/**
 * A stop's comments on its code, under its answer; before any, a hint that lines can be selected
 * to comment on them. Each comment opens in the editor to change or delete it.
 */
export function StopLineComments({ target, stop }: { target: GuidedReviewTarget; stop: number }) {
  const draft = useGuidedReviewState((state) => state.drafts[target.meta.reviewId]);
  const sent = draft?.sentAt !== undefined;
  const comments = sortLineComments((draft?.lineComments ?? []).filter((comment) => comment.stop === stop));
  if (!comments.length) {
    return sent ? null : <p className="text-[13px] text-cc-muted">Select lines in the code to comment on them.</p>;
  }
  return (
    <div className="space-y-1.5" data-testid="guided-review-stop-comments">
      <div className="text-[13px] text-cc-muted">Your comments on this code</div>
      <LineCommentList comments={comments} sent={sent} />
    </div>
  );
}

/** Every comment on the code in reading order, in the wrap-up beside the answers; hidden when there are none. */
export function AllLineComments({ target }: { target: GuidedReviewTarget }) {
  const draft = useGuidedReviewState((state) => state.drafts[target.meta.reviewId]);
  const comments = sortLineComments(draft?.lineComments ?? []);
  if (!comments.length) return null;
  return (
    <div className="space-y-2" data-testid="guided-review-line-comments">
      <div className="text-[13px] font-medium uppercase tracking-wide text-cc-muted">Your comments on the code</div>
      <LineCommentList
        comments={comments}
        sent={draft?.sentAt !== undefined}
        stopTitle={(comment) => target.meta.map.stops[comment.stop]?.title}
      />
    </div>
  );
}

function LineCommentList({
  comments,
  sent,
  stopTitle,
}: {
  comments: GuidedReviewLineComment[];
  sent: boolean;
  stopTitle?: (comment: GuidedReviewLineComment) => string | undefined;
}) {
  return (
    <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
      {comments.map((comment) => {
        const body = (
          <>
            <CommentPlace comment={comment} />
            {stopTitle?.(comment) && <span className="block text-[12px] text-cc-muted">{stopTitle(comment)}</span>}
            <span className={`block whitespace-pre-wrap text-[14px] text-cc-fg ${sent ? "" : "line-clamp-4"}`}>
              {comment.comment}
            </span>
          </>
        );
        return sent ? (
          <div key={comment.id} className="px-3 py-2">
            {body}
          </div>
        ) : (
          <button
            key={comment.id}
            type="button"
            onClick={() => openLineCommentEditor({ comment })}
            className="block w-full px-3 py-2 text-left hover:bg-cc-hover"
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** Which file and lines a comment is on: the file name in lists, the whole path in the editor. */
function CommentPlace({ comment, full = false }: { comment: GuidedReviewLineComment; full?: boolean }) {
  const name = full ? comment.path : comment.path.slice(comment.path.lastIndexOf("/") + 1);
  return (
    <span className="block text-[12px] text-cc-muted [overflow-wrap:anywhere]" title={comment.path}>
      <span className="font-mono-code text-cc-fg">{name}</span> ·{" "}
      {/* A non-breaking hyphen keeps a range like 118-122 on one line. */}
      {lineCommentSpan(comment).replace(/(\d)-(\d)/g, "$1\u2011$2")}
    </span>
  );
}

/**
 * The whole lines a selection touches in one piece of review code, with their numbers and the
 * code as shown; null when it touches no code line or code from more than one piece.
 */
export function codeLinesInRange(range: Range, container: HTMLElement): CodeLines | null {
  let found: CodeLines | null = null;
  for (const piece of container.querySelectorAll<HTMLElement>("[data-review-code]")) {
    if (!range.intersectsNode(piece)) continue;
    // A row counts when the selection covers some of its code; ending at the very start of the next
    // row, as a triple click does, does not count that row.
    const rows = [...piece.querySelectorAll<HTMLElement>(".diff-line")].filter((row) => {
      const content = row.querySelector(".diff-content");
      return content ? !!intersectRangeWithNodeContents(range, content)?.toString() : false;
    });
    if (!rows.length) continue;
    if (found) return null;
    found = describeRows(rows, Number(piece.dataset.reviewStop), piece.dataset.reviewPath ?? "");
  }
  return found;
}

function describeRows(rows: HTMLElement[], stop: number, path: string): CodeLines {
  const span = (list: number[]): [number, number] | undefined => (list.length ? [list[0], list.at(-1)!] : undefined);
  // Kept and added lines are numbered as in the file after the change; removed lines exist only before it.
  const lines = span(rows.filter((row) => row.dataset.newLine).map((row) => Number(row.dataset.newLine)));
  const removedLines = span(
    rows.filter((row) => !row.dataset.newLine && row.dataset.oldLine).map((row) => Number(row.dataset.oldLine)),
  );
  const code = rows
    .map((row) => {
      const marker = row.classList.contains("diff-line-add")
        ? "+"
        : row.classList.contains("diff-line-del")
          ? "-"
          : " ";
      // An empty line is drawn as a no-break space so it keeps its height.
      const text = row.querySelector(".diff-content")?.textContent ?? "";
      return marker + (text === "\u00a0" ? "" : text);
    })
    .join("\n");
  return { stop, path, ...(lines ? { lines } : {}), ...(removedLines ? { removedLines } : {}), code };
}
