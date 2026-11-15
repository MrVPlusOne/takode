/**
 * Message Box: the Markdown box every chat input uses by default, beside the plain textarea the
 * Message Box setting can switch to, with a draft that shows each style and quest and session
 * links (Cmd/Ctrl+click opens one; hovering shows its card).
 */
import { useState } from "react";
import { MarkdownReferenceLinks } from "../MarkdownReferenceLinks.js";
import { RichTextBox } from "../RichTextBox.js";
import type { RichTextBoxElement } from "../rich-text-box.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const DRAFT = [
  "## Sidebar fold review",
  "Can you check the **sidebar fold** before it lands? See q-1 and #1, and keep `useRememberedFold` as it is.",
  "- try it at *430 px* wide",
  "- compare with [the old build](https://example.com/build)",
  "> The hover card still flickers on Safari",
  "```",
  'const fold = useRememberedFold("sidebar");',
  "```",
  "[transcribed]",
].join("\n");

const BOX_CLASS =
  "block w-full rounded-[14px] border border-cc-border bg-cc-input-bg px-4 py-3 font-sans-ui text-base text-cc-fg focus:outline-none sm:text-sm";

export function PlaygroundMessageBoxSection() {
  const [markdown, setMarkdown] = useState(DRAFT);
  const [plain, setPlain] = useState(DRAFT);
  const [box, setBox] = useState<RichTextBoxElement | null>(null);
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Message Box"
        description="Every chat input (message box, side chats, comments and answers) draws basic Markdown and quest and session links as you type, with each character as wide as plain text so nothing moves; the text stays plain Markdown. Settings > Appearance > Message Box switches a browser to the plain textarea."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card label="Markdown (default)">
            <RichTextBox
              ref={setBox}
              aria-label="Markdown message box"
              value={markdown}
              onInput={(event) => setMarkdown(event.currentTarget.value)}
              placeholder="Type a message..."
              className={BOX_CLASS}
            />
            <MarkdownReferenceLinks box={box} />
          </Card>
          <Card label="Plain">
            <textarea
              aria-label="Plain message box"
              value={plain}
              onChange={(event) => setPlain(event.target.value)}
              rows={10}
              className={`${BOX_CLASS} resize-none`}
            />
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
