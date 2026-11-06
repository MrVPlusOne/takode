import {
  destinationLabel,
  draftPartLabel,
  groupDraftPosts,
  parseDraftBlock,
  scanFences,
  draftMarkdown,
  type DraftDestination,
} from "../shared/draft-posts.js";
import { withoutFrontMatter } from "../shared/slides.js";
import type { ChatMessage, SessionNotification } from "./types.js";
import { getMessageMarkdown } from "./utils/copy-utils.js";

/**
 * The Markdown Read aloud reads for a message: a report's text without its front matter, else the
 * message's text, with each drafted post written out as a `<draft>` section (see
 * {@link readAloudDraftText}). Every way of starting a read uses it (the message menu, a report's
 * header, voiceback), so they all read a message the same way.
 */
export function readAloudMessageText(message: ChatMessage): string {
  const text = message.metadata?.markdownReport ? withoutFrontMatter(message.content) : getMessageMarkdown(message);
  return withDraftsForReading(text);
}

/** A drafted post as the rewrite reads it: what its card shows, part by part. */
export interface ReadableDraftPost {
  title?: string;
  destination?: DraftDestination;
  parts: ReadonlyArray<{ label: string; text: string; attachments: ReadonlyArray<{ path: string }> }>;
}

/**
 * A drafted post as a `<draft>` section, which the server's rewrite reads out in full as the
 * message to be sent. A ```draft fence would be taken for code and left out. Names where the post
 * goes but not its link, and attached files by name.
 */
export function readAloudDraftText(post: ReadableDraftPost): string {
  const lines = ["<draft>"];
  if (post.title) lines.push(`Title: ${post.title}`);
  if (post.destination) lines.push(`Goes to: ${destinationLabel(post.destination)}`);
  for (const part of post.parts) {
    if (post.parts.length > 1) lines.push("", `${part.label}:`);
    lines.push(draftMarkdown(part.text).trim());
    for (const attachment of part.attachments) lines.push(`(Attached file: ${attachment.path.split("/").pop()})`);
  }
  lines.push("</draft>");
  return lines.join("\n");
}

/**
 * A question an agent is waiting on (a needs-input prompt) as a `<question>` section: its title,
 * each question and its suggested answers, as the question card shows them. The server's rewrite
 * reads it out in full, so a listener hears the choices without looking at the card.
 */
export function readAloudQuestionText(
  notification: Pick<SessionNotification, "summary" | "questions" | "suggestedAnswers">,
): string {
  const lines = ["<question>"];
  if (notification.summary) lines.push(`Title: ${notification.summary}`);
  const questions = notification.questions ?? [];
  questions.forEach((question, index) => {
    lines.push(questions.length > 1 ? `${index + 1}. ${question.prompt}` : question.prompt);
    if (question.suggestedAnswers?.length) lines.push(`Suggested answers: ${question.suggestedAnswers.join("; ")}`);
  });
  if (questions.length === 0 && notification.suggestedAnswers?.length) {
    lines.push(`Suggested answers: ${notification.suggestedAnswers.join("; ")}`);
  }
  lines.push("</question>");
  return lines.join("\n");
}

/** Text with each post's ```draft blocks replaced, where its first block was, by its `<draft>` section. */
function withDraftsForReading(text: string): string {
  const drafts = scanFences(text)
    .fences.filter((fence) => fence.language === "draft")
    .map((fence) => ({ fence, ...parseDraftBlock(fence.body) }));
  if (drafts.length === 0) return text;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const blocks of groupDraftPosts(drafts)) {
    const replacement = readAloudDraftText({
      title: blocks[0]!.title,
      destination: blocks.find((block) => block.destination)?.destination,
      parts: blocks.map((block, index) => ({
        label: draftPartLabel((block.part ?? index + 1) - 1),
        text: block.body,
        attachments: block.attachments.map((path) => ({ path })),
      })),
    });
    blocks.forEach(({ fence }, index) =>
      edits.push({ start: fence.start, end: fence.end, replacement: index === 0 ? replacement : "" }),
    );
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
