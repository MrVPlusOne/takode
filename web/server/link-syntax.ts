export const TAKODE_LINK_SYNTAX_INSTRUCTIONS = [
  "This session uses Takode custom links. **Always use link syntax** -- never write plain `q-5` or `#5` in responses.",
  "These rules override any conflicting generic markdown-link or file-reference instructions from other prompts.",
  "Even if the user refers to quests or sessions in plain text like `q-350` or `#123`, you should still emit the Takode link syntax in your response.",
  "Takode link syntax renders rich links in the chat UI, which gives a better experience because users can hover for previews and click through directly to the corresponding quest or session.",
  "Quests: `[q-42](quest:q-42)`. Sessions: `[#5](session:5)`. Session messages: `[#5 msg 42](session:5:42)` -- message IDs come from takode peek/read/scan output indices.",
  "Files: use short labels with repo-root-relative `file:` links like `[app.ts:42](file:src/app.ts:42)`, including in quest comments and phase documentation. Absolute `file:` paths work as fallback. Do not use `file://` URI schemes.",
  "Supported file-link suffixes: `:line`, `:line:column`, `:startLine-endLine`.",
].join(" ");
