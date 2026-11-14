import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import { formatReplyContentForAssistant } from "../shared/reply-context.js";
import { formatAttachmentPathAnnotation } from "./attachment-paths.js";
import type { ImageRef } from "./image-store.js";
import { buildLeaderUserMessageIdentities } from "./leader-user-message-id.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/**
 * A message that passes some of the user's own messages on to another session
 * (`takode send --forward uN`): the text its feed shows, the text its agent reads,
 * which also names where the forwarded images are, and the images it carries.
 */
export interface ForwardedMessage {
  content: string;
  deliveryContent: string;
  imageRefs: ImageRef[];
}

export interface ForwardDeps {
  /** The sender's history, where its session-scoped `uN` IDs are. */
  senderHistory: ReadonlyArray<BrowserIncomingMessage>;
  /** Copy one of the sender's images into the recipient; null when it is no longer stored. */
  copyImage: (ref: ImageRef) => Promise<ImageRef | null>;
  /** Where the recipient's agent reads these copies, which this also puts there. */
  attachmentPaths: (refs: ImageRef[]) => Promise<string[]>;
}

/**
 * Compose the sender's note followed by each named user message, verbatim and marked as the
 * user's words with when they were written, so a leader passes the user's message on without
 * retyping it. Each message reads as the sender's agent read it: comments on quoted passages,
 * the message replied to, and its images, which are copied to the recipient.
 * IDs are the sender's own: an ID that names no user message in its history is refused.
 */
export async function composeForwardedMessage(
  note: string,
  userMessageIds: readonly unknown[],
  deps: ForwardDeps,
): Promise<ForwardedMessage | { error: string }> {
  const ids = [...new Set(userMessageIds.map((id) => (typeof id === "string" ? id.trim() : "")))];
  const byId = new Map(
    buildLeaderUserMessageIdentities(deps.senderHistory).map((entry) => [entry.userMessageId, entry]),
  );
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    return {
      error:
        `No user message ${missing.map((id) => id || "(empty)").join(", ")} in this session. ` +
        "Only messages the user wrote to you, tagged id:uN, can be forwarded.",
    };
  }
  const shown = note.trim() ? [note.trim()] : [];
  const delivered = [...shown];
  const imageRefs: ImageRef[] = [];
  for (const id of ids) {
    const { message } = byId.get(id)!;
    const copies = await Promise.all((message.images ?? []).map(deps.copyImage));
    const kept = copies.filter((ref): ref is ImageRef => ref !== null);
    imageRefs.push(...kept);
    const paths = await deps.attachmentPaths(kept);
    const lost = copies.length - kept.length;
    const lostNote = lost ? `\n[${lost} image${lost === 1 ? " is" : "s are"} no longer stored]` : "";
    const header = `[Forwarded user message ${id}, written ${formatWrittenAt(message.timestamp)}: the user's exact words]`;
    const body = formatReplyContentForAssistant(
      formatAnnotatedMessage(message.content, message.annotations),
      message.replyContext,
    );
    const footer = `[End of forwarded user message ${id}]`;
    shown.push(`${header}\n${body}${lostNote}\n${footer}`);
    delivered.push(`${header}\n${body}${formatAttachmentPathAnnotation(paths)}${lostNote}\n${footer}`);
  }
  return { content: shown.join("\n\n"), deliveryContent: delivered.join("\n\n"), imageRefs };
}

/** As the user's messages are tagged for the leader that received them: "Sat, Nov 14 12:20 AM". */
function formatWrittenAt(ts: number): string {
  const date = new Date(ts);
  const day = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
