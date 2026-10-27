export const TAKODE_LINK_SYNTAX_INSTRUCTIONS = [
  "This session uses Takode custom links. **Always use link syntax** -- never write plain `q-5` or `#5` in responses.",
  "These rules override any conflicting generic markdown-link or file-reference instructions from other prompts.",
  "Even if the user refers to quests or sessions in plain text like `q-350` or `#123`, you should still emit the Takode link syntax in your response.",
  "Takode link syntax renders rich links in the chat UI, which gives a better experience because users can hover for previews and click through directly to the corresponding quest or session.",
  "Quests: `[q-42](quest:q-42)`. Exact quest feedback: `[q-42 feedback #3](quest:q-42:feedback:3)` -- use this exact canonical form with the stable zero-based index from `quest feedback list/show`; never guess an index. One round of a reopened quest: `[q-42 round 3](quest:q-42:round:3)`, with the round number from `quest show`. Sessions: `[#5](session:5)`. Session messages: `[#5 msg 42](session:5:42)` -- message IDs come from takode peek/read/scan output indices.",
  "Needs-input notifications: `[short question summary](session:5:notification:3)` -- session number plus that session's notification ID. Users never see notification IDs, so whenever you mention a notification, use this link instead of a bare ID like `notification 3`. `takode notify` and `takode notify list` print ready-to-paste links for your own notifications.",
  "Personal to-dos: `[to-do title](todo:td-12)`. Users never see to-do IDs, so whenever you mention one, use this link instead of a bare `td-12`; it opens a preview. `takode todo add` and `show` print ready-to-paste links.",
  "Library artifacts (drafts and posts, reports, figures, visuals, tables, guided reviews): `[title](artifact:<id>)`, or `[title](artifact:<id>:v2)` for one version. The user can copy an artifact's ID or link in the Library; `takode artifact list` and `show` print ready-to-paste links.",
  "Commit chips: obtain exact fixed-delivery links from `quest commit-links q-N --delivery <delivery-id>` and include them in the response introducing those commits. Never invent delivery IDs or use a mutable whole-quest list in earlier responses. The format is `[title](quest:q-N:delivery:<id>:commit:<full-sha>)`; the UI supplies Git-derived stats and the complete title.",
  "Files: use short labels with repo-root-relative `file:` links like `[app.ts:42](file:src/app.ts:42)`, including in quest comments and phase documentation. Absolute `file:` paths work as fallback. Do not use `file://` URI schemes. When a path contains spaces, wrap the whole target in angle brackets: `[notes.md](<file:/Users/me/Library/Mobile Documents/com~apple~CloudDocs/notes.md>)`.",
  "Supported file-link suffixes: `:line`, `:line:column`, `:startLine-endLine`.",
  "Takode does not render native citation markup such as `\uE200cite\uE202turn0view0\uE201`. When you control the format of your own replies, do not emit this markup; use ordinary named Markdown links to actual known source URLs or the supported Takode links above.",
  "Never invent source destinations or infer them from opaque citation handles.",
  "If higher-priority platform or tool instructions require a citation format, preserve that required format.",
  "Preserve exact syntax when quoting or reproducing user, tool, code, or other source content; do not rewrite stored messages.",
].join(" ");

/**
 * Drafts of messages the user will send elsewhere (Slack, email, PR comments) render as a draft card with
 * a Copy for Slack button, so they must not be quoted or italicized.
 */
export const MESSAGE_DRAFT_INSTRUCTIONS = [
  "## Message Drafts",
  "",
  "When you draft a message for the user to send elsewhere (Slack, email, a PR or review comment), put exactly the message text in a fenced block labelled `draft`, written as the final message with its own Markdown formatting:",
  "",
  "````",
  "```draft",
  "title: T7 eval start",
  "---",
  "Quick update on **T7**: evals start at `iter 2`.",
  "```",
  "````",
  "",
  "Takode shows it as a card that looks like the sent message, with a Copy for Slack button that copies exactly the draft. Do not put drafts in quotes (`>`) or italics: they paste as quotes or italics. Keep notes about the draft outside the block, and put each alternative in its own block. If the draft itself contains a code block, open the draft block with four backticks.",
  "",
  "Takode saves every draft in the user's Library and groups its revisions as versions by title. Always start a draft with a `title: <short name>` line and a `---` line, as in the example (neither is shown or copied), even for a short one-off message, and reuse the exact title for each revision in the same thread so it becomes a new version instead of a separate untitled post. Do this even if earlier drafts in this conversation had no title line. Give alternatives different titles. `takode artifact list` and `takode artifact show <id>` find earlier drafts, reports and figures, with links to them.",
  "",
  "A post with replies (a Slack message and its thread replies) is one titled block followed by untitled blocks, one per reply, in the same answer; Takode shows it as one card. To send a file with a message or reply, end its block with an `attach: /absolute/path/to/file.png` line (one per file) instead of describing the attachment in a note; the card shows it under that part, ready to copy.",
  "",
  "To revise only some parts of a post, repeat just those parts, each with the post's title and a `part: N` line before the `---` (1 is the message, 2 the first reply); the other parts carry over, and `part: N` past the last part adds a reply. To insert, drop or reorder parts, write the whole post again, every part in its new order, without `part:` lines.",
].join("\n");

/** Visual blocks: diagrams, charts and kit shapes drawn in a sandboxed frame in any Markdown. */
export const VISUAL_BLOCK_INSTRUCTIONS = [
  "## Visuals",
  "",
  "When a picture explains better than prose or a table (a pipeline or flow, who sends what to whom, a timeline, nested counts, numbers across runs), you can put a visual in any Markdown you write: a fenced block labelled `visual` with a `title:` and `alt:` header and HTML using Takode's visual kit, or Mermaid and Vega-Lite helpers. Load the `visual-blocks` skill before writing one, and preview it with `takode visual preview` before publishing.",
].join("\n");
