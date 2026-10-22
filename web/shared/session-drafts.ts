import { readConversationAnnotations, type ConversationAnnotation } from "./conversation-annotations.js";

/**
 * Unsent drafts the server keeps per session so every browser of the user shares
 * them: the message box (composer) and partly answered needs-input prompts.
 *
 * Writes follow "last write the server receives wins", per draft. The server
 * numbers every write with a per-session revision; browsers use it to tell which
 * of two competing writes is newer and to ignore echoes of their own writes.
 */

/** The composer fields that sync. Images sync once uploaded; uploads in progress stay in their tab. */
export interface SyncedComposerDraft {
  text: string;
  annotations?: ConversationAnnotation[];
  images?: SyncedDraftImage[];
}

/** The server's reference to an uploaded image, as returned by image preparation. */
export interface SyncedDraftImageRef {
  imageId: string;
  media_type: string;
  optimized?: boolean;
  sourceName?: string;
}

/**
 * An image attached to the draft and already uploaded to the server. `path` is
 * where the agent reads it; the server derives it from the image reference and
 * never takes it from a browser.
 */
export interface SyncedDraftImage {
  imageRef: SyncedDraftImageRef;
  name: string;
  path: string;
}

/**
 * A guided review's answers by stop index (the text of each answer field), the message about the
 * whole review, and when they were sent. Once sent, the server keeps the entry and refuses further
 * changes, so every browser shows the review as answered and none can send it again.
 */
export interface SyncedGuidedReviewDraft {
  answers: Record<string, string>;
  /** The user's message about the review as a whole, such as what should happen next. */
  message?: string;
  sentAt?: number;
}

/** Answers per question key for one unsubmitted needs-input prompt. */
export type SyncedNeedsInputAnswers = Record<string, string>;

interface DraftEntryMeta {
  /** Per-session server write number; higher is newer. */
  revision: number;
  /** Browser tab that wrote it. */
  clientId: string;
  updatedAt: number;
}

export interface SyncedComposerDraftEntry extends DraftEntryMeta {
  draft: SyncedComposerDraft;
}

export interface SyncedNeedsInputDraftEntry extends DraftEntryMeta {
  answers: SyncedNeedsInputAnswers;
}

export interface SyncedGuidedReviewDraftEntry extends DraftEntryMeta {
  draft: SyncedGuidedReviewDraft;
}

export interface SessionDraftsState {
  /** Latest write revision for this session, kept even after drafts are cleared. */
  revision: number;
  composer?: SyncedComposerDraftEntry;
  needsInput?: Record<string, SyncedNeedsInputDraftEntry>;
  /** Guided review answers by review ID, including sent ones. */
  guidedReviews?: Record<string, SyncedGuidedReviewDraftEntry>;
  /** Finished voice transcriptions no browser has put into its draft yet, by request ID. */
  voiceResults?: Record<string, import("./voice-results.js").PendingVoiceResult>;
}

/** One browser write. A null value clears that draft. */
export type SessionDraftWrite =
  | { kind: "composer"; draft: SyncedComposerDraft | null }
  | { kind: "needs-input"; notificationId: string; answers: SyncedNeedsInputAnswers | null }
  | { kind: "guided-review"; reviewId: string; draft: SyncedGuidedReviewDraft | null };

export interface SessionDraftWriteRequest {
  clientId: string;
  write: SessionDraftWrite;
}

/** An applied write, as acknowledged to its writer and broadcast to the session's browsers. */
export type SessionDraftChange = SessionDraftWrite & DraftEntryMeta;

export const MAX_COMPOSER_DRAFT_TEXT_CHARS = 200_000;
export const MAX_COMPOSER_DRAFT_IMAGES = 20;
export const MAX_NEEDS_INPUT_DRAFT_QUESTIONS = 50;
export const MAX_NEEDS_INPUT_DRAFT_ANSWER_CHARS = 20_000;
const MAX_CLIENT_ID_CHARS = 100;
const MAX_GUIDED_REVIEW_ANSWERS = 60;
const REVIEW_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

/** Identifies a draft within a session, for per-draft bookkeeping. */
export function sessionDraftKey(
  write: Pick<SessionDraftWrite, "kind"> & { notificationId?: string; reviewId?: string },
): string {
  if (write.kind === "composer") return "composer";
  if (write.kind === "guided-review") return `guided-review:${write.reviewId}`;
  return `needs-input:${write.notificationId}`;
}

/** Empty answers and messages are dropped; a draft with neither that was never sent is stored as cleared. */
export function normalizeSyncedGuidedReviewDraft(
  draft: SyncedGuidedReviewDraft | null,
): SyncedGuidedReviewDraft | null {
  if (!draft) return null;
  const answers = Object.fromEntries(Object.entries(draft.answers).filter(([, value]) => value.trim() !== ""));
  const message = draft.message?.trim() ? draft.message : undefined;
  if (!Object.keys(answers).length && message === undefined && draft.sentAt === undefined) return null;
  return {
    answers,
    ...(message !== undefined ? { message } : {}),
    ...(draft.sentAt !== undefined ? { sentAt: draft.sentAt } : {}),
  };
}

function readGuidedReviewDraft(value: unknown): SyncedGuidedReviewDraft {
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error("draft.answers must be an object.");
  const entries = Object.entries(value.answers);
  if (entries.length > MAX_GUIDED_REVIEW_ANSWERS) throw new Error("Too many answers.");
  for (const [key, answer] of entries) {
    if (!/^\d{1,3}$/.test(key) || typeof answer !== "string") throw new Error("Each answer must be a string.");
    if (answer.length > MAX_NEEDS_INPUT_DRAFT_ANSWER_CHARS) throw new Error("An answer is too long.");
  }
  if (
    value.message !== undefined &&
    (typeof value.message !== "string" || value.message.length > MAX_NEEDS_INPUT_DRAFT_ANSWER_CHARS)
  ) {
    throw new Error("draft.message must be a string of at most 20,000 characters.");
  }
  if (value.sentAt !== undefined && (typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt))) {
    throw new Error("draft.sentAt must be a time.");
  }
  return {
    answers: value.answers as Record<string, string>,
    ...(value.message !== undefined ? { message: value.message as string } : {}),
    ...(value.sentAt !== undefined ? { sentAt: value.sentAt as number } : {}),
  };
}

/** Empty drafts are stored as cleared, so "nothing typed" never lingers as a draft. */
export function normalizeSyncedComposerDraft(draft: SyncedComposerDraft | null): SyncedComposerDraft | null {
  if (!draft) return null;
  const annotations = draft.annotations?.length ? draft.annotations : undefined;
  const images = draft.images?.length ? draft.images : undefined;
  if (!draft.text && !annotations && !images) return null;
  return {
    text: draft.text,
    ...(annotations ? { annotations } : {}),
    ...(images ? { images } : {}),
  };
}

const IMAGE_ID_PATTERN = /^[0-9]+-[0-9]+-[0-9a-f]+$/;
const IMAGE_MEDIA_TYPE_PATTERN = /^image\/[a-z0-9.+-]+$/i;

/**
 * Validates draft image references; throws on malformed ones. The image ID shape is
 * checked strictly because the server builds the agent-visible file path from it.
 */
export function readSyncedDraftImages(value: unknown): SyncedDraftImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("draft.images must be an array.");
  if (value.length > MAX_COMPOSER_DRAFT_IMAGES) throw new Error("Too many draft images.");
  return value.map((image) => {
    if (!isRecord(image) || !isRecord(image.imageRef)) throw new Error("Each draft image needs an imageRef.");
    const ref = image.imageRef;
    if (typeof ref.imageId !== "string" || !IMAGE_ID_PATTERN.test(ref.imageId)) {
      throw new Error("Invalid draft image ID.");
    }
    if (typeof ref.media_type !== "string" || !IMAGE_MEDIA_TYPE_PATTERN.test(ref.media_type)) {
      throw new Error("Invalid draft image media type.");
    }
    if (typeof image.name !== "string" || image.name.length > 500) throw new Error("Invalid draft image name.");
    return {
      imageRef: {
        imageId: ref.imageId,
        media_type: ref.media_type,
        ...(ref.optimized === true ? { optimized: true } : {}),
        ...(typeof ref.sourceName === "string" ? { sourceName: ref.sourceName.slice(0, 500) } : {}),
      },
      name: image.name,
      path: typeof image.path === "string" ? image.path : "",
    };
  });
}

export function normalizeSyncedNeedsInputAnswers(
  answers: SyncedNeedsInputAnswers | null,
): SyncedNeedsInputAnswers | null {
  if (!answers) return null;
  const kept = Object.entries(answers).filter(([, value]) => value !== "");
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

/** Validates an untrusted write request; returns an error message when it is malformed or too large. */
export function readSessionDraftWriteRequest(value: unknown): SessionDraftWriteRequest | { error: string } {
  if (!isRecord(value)) return { error: "Request body must be an object." };
  const { clientId, write } = value;
  if (typeof clientId !== "string" || !clientId || clientId.length > MAX_CLIENT_ID_CHARS) {
    return { error: "clientId must be a short non-empty string." };
  }
  if (!isRecord(write)) return { error: "write must be an object." };
  if (write.kind === "composer") {
    if (write.draft === null) return { clientId, write: { kind: "composer", draft: null } };
    const draft = write.draft;
    if (!isRecord(draft) || typeof draft.text !== "string") return { error: "draft.text must be a string." };
    if (draft.text.length > MAX_COMPOSER_DRAFT_TEXT_CHARS) return { error: "Draft text is too long." };
    let annotations: ConversationAnnotation[];
    let images: SyncedDraftImage[];
    try {
      annotations = readConversationAnnotations(draft.annotations);
      images = readSyncedDraftImages(draft.images);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid draft." };
    }
    return {
      clientId,
      write: {
        kind: "composer",
        draft: normalizeSyncedComposerDraft({
          text: draft.text,
          annotations,
          images,
        }),
      },
    };
  }
  if (write.kind === "needs-input") {
    const { notificationId, answers } = write;
    if (typeof notificationId !== "string" || !notificationId) return { error: "notificationId is required." };
    if (answers === null) return { clientId, write: { kind: "needs-input", notificationId, answers: null } };
    if (!isRecord(answers)) return { error: "answers must be an object." };
    const entries = Object.entries(answers);
    if (entries.length > MAX_NEEDS_INPUT_DRAFT_QUESTIONS) return { error: "Too many answers." };
    for (const [, answer] of entries) {
      if (typeof answer !== "string") return { error: "Each answer must be a string." };
      if (answer.length > MAX_NEEDS_INPUT_DRAFT_ANSWER_CHARS) return { error: "An answer is too long." };
    }
    return {
      clientId,
      write: {
        kind: "needs-input",
        notificationId,
        answers: normalizeSyncedNeedsInputAnswers(answers as SyncedNeedsInputAnswers),
      },
    };
  }
  if (write.kind === "guided-review") {
    const { reviewId } = write;
    if (typeof reviewId !== "string" || !REVIEW_ID_PATTERN.test(reviewId)) return { error: "reviewId is required." };
    if (write.draft === null) return { clientId, write: { kind: "guided-review", reviewId, draft: null } };
    try {
      return {
        clientId,
        write: {
          kind: "guided-review",
          reviewId,
          draft: normalizeSyncedGuidedReviewDraft(readGuidedReviewDraft(write.draft)),
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid review answers." };
    }
  }
  return { error: "write.kind must be composer, needs-input or guided-review." };
}

/** Reads persisted drafts defensively; malformed parts are dropped. */
export function readSessionDraftsState(value: unknown): SessionDraftsState | undefined {
  if (!isRecord(value) || typeof value.revision !== "number") return undefined;
  const state: SessionDraftsState = { revision: value.revision };
  if (isRecord(value.composer) && isEntryMeta(value.composer) && isRecord(value.composer.draft)) {
    const draft = value.composer.draft;
    if (typeof draft.text === "string") {
      try {
        const normalized = normalizeSyncedComposerDraft({
          text: draft.text,
          annotations: readConversationAnnotations(draft.annotations),
          images: readSyncedDraftImages(draft.images),
        });
        if (normalized) state.composer = { ...entryMeta(value.composer), draft: normalized };
      } catch {
        // Unreadable annotations or images: drop the composer draft rather than the whole state.
      }
    }
  }
  if (isRecord(value.needsInput)) {
    const needsInput: Record<string, SyncedNeedsInputDraftEntry> = {};
    for (const [notificationId, entry] of Object.entries(value.needsInput)) {
      if (!isRecord(entry) || !isEntryMeta(entry) || !isRecord(entry.answers)) continue;
      const answers = normalizeSyncedNeedsInputAnswers(
        Object.fromEntries(
          Object.entries(entry.answers).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
        ),
      );
      if (answers) needsInput[notificationId] = { ...entryMeta(entry), answers };
    }
    if (Object.keys(needsInput).length > 0) state.needsInput = needsInput;
  }
  if (isRecord(value.guidedReviews)) {
    const guidedReviews: Record<string, SyncedGuidedReviewDraftEntry> = {};
    for (const [reviewId, entry] of Object.entries(value.guidedReviews)) {
      if (!isRecord(entry) || !isEntryMeta(entry)) continue;
      try {
        const draft = normalizeSyncedGuidedReviewDraft(readGuidedReviewDraft(entry.draft));
        if (draft) guidedReviews[reviewId] = { ...entryMeta(entry), draft };
      } catch {
        // An unreadable entry is dropped; the others are kept.
      }
    }
    if (Object.keys(guidedReviews).length > 0) state.guidedReviews = guidedReviews;
  }
  return state;
}

function isEntryMeta(value: Record<string, unknown>): boolean {
  return (
    typeof value.revision === "number" && typeof value.clientId === "string" && typeof value.updatedAt === "number"
  );
}

function entryMeta(value: Record<string, unknown>): DraftEntryMeta {
  return {
    revision: value.revision as number,
    clientId: value.clientId as string,
    updatedAt: value.updatedAt as number,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
