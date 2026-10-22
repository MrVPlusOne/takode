import { buildFileLinkBrowserUrl } from "../../api/file-link-actions.js";
import { useStore } from "../../store.js";
import { openInAppPage } from "../InAppPageViewer.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { Card, Section } from "./shared.js";

const DEMO_HTML_PATH = "web/src/components/playground/html-file-link-demo/index.html";

export function PlaygroundFileLinkSection() {
  const sessionId = useStore((s) => s.currentSessionId) ?? undefined;
  return (
    <Section
      title="File Link Context Menu"
      description="HTML links use native new-tab browser navigation (an in-app sheet in the iPhone Home Screen app), Markdown links open in Takode's file viewer, while right-click and long-press retain explicit file actions and other file types keep their existing defaults."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Chat markdown with browser, viewer, editor, and image file links">
          <div className="space-y-2">
            <p className="text-xs text-cc-muted">
              Live fixture links resolve through the currently selected session. Select a session rooted in this Takode
              checkout before opening the demo.
            </p>
            <MarkdownContent
              text={
                "Open the [interactive HTML demo](file:web/src/components/playground/html-file-link-demo/index.html), inspect [MarkdownContent.tsx:1](file:web/src/components/MarkdownContent.tsx:1), read [markdown-reports.md](file:docs/markdown-reports.md) in Takode, or preview [badge.svg](file:web/src/components/playground/html-file-link-demo/badge.svg)."
              }
            />
          </div>
        </Card>
        <Card label="In-app page viewer (iPhone Home Screen app)">
          <div className="space-y-2">
            <p className="text-xs text-cc-muted">
              The Home Screen app has no tabs, so there the HTML link above, and any link opening a Takode-origin page
              in a new tab, shows the page in this sheet instead of replacing the app.
            </p>
            <button
              type="button"
              className="rounded-md border border-cc-border px-3 py-1.5 text-xs text-cc-fg hover:bg-cc-hover"
              onClick={() =>
                openInAppPage(
                  buildFileLinkBrowserUrl({ path: DEMO_HTML_PATH, isRelative: true, sessionId }),
                  DEMO_HTML_PATH,
                )
              }
            >
              Open the HTML demo in the viewer
            </button>
          </div>
        </Card>
        <Card label="Paths with spaces, tildes and parentheses (iCloud Drive)">
          <MarkdownContent
            text={[
              "Agents write iCloud Drive links by their real path: [Trip_Plan_2026-10.md](file:/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Travel/Trip_Plan_2026-10.md)。",
              "The bracketed form also works: [Budget (1).pdf](<file:/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Travel/Budget (1).pdf:2>).",
              "Single tildes stay literal (~/a and ~/b in ~5 min) while ~~double tildes~~ strike through; code stays as written: `[a](file:/tmp/My Docs/a.md)`.",
            ].join("\n\n")}
          />
        </Card>
      </div>
    </Section>
  );
}
