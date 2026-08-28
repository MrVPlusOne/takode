import { MarkdownContent } from "../MarkdownContent.js";
import { Card, Section } from "./shared.js";

export function PlaygroundFileLinkSection() {
  return (
    <Section
      title="File Link Context Menu"
      description="HTML links use native new-tab browser navigation, while right-click and long-press retain explicit file actions and other file types keep their existing defaults."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Chat markdown with browser, editor, and image file links">
          <div className="space-y-2">
            <p className="text-xs text-cc-muted">
              Live fixture links resolve through the currently selected session. Select a session rooted in this Takode
              checkout before opening the demo.
            </p>
            <MarkdownContent
              text={
                "Open the [interactive HTML demo](file:web/src/components/playground/html-file-link-demo/index.html), inspect [MarkdownContent.tsx:1](file:web/src/components/MarkdownContent.tsx:1), or preview [badge.svg](file:web/src/components/playground/html-file-link-demo/badge.svg)."
              }
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
