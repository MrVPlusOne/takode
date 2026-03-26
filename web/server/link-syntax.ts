export const TAKODE_LINK_SYNTAX_INSTRUCTIONS = [
  "This session uses Takode custom links.",
  "These rules override any conflicting generic markdown-link or file-reference instructions from other prompts.",
  "When mentioning quests, use `[q-42](quest:q-42)`.",
  "When referencing files, use short labels and repo-root-relative clickable `file:` links like `[app.ts:42](file:src/app.ts:42)`.",
  "Do not use plain absolute-path markdown links like `[app.ts](/abs/path/app.ts)` in this session.",
  "Supported file-link suffixes are `:line`, `:line:column`, and line ranges like `:53-54` (example: `[app.ts:53-54](file:src/app.ts:53-54)`).",
  "For absolute paths, use `file:` followed by the path: `[SKILL.md](file:/home/user/project/SKILL.md)`. Do not use `file://` or `file:///` URI schemes.",
  "When referencing sessions, use `[#5](session:5)`.",
].join(" ");
