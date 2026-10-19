import { useState } from "react";
import { makeMarkdownReportFixture } from "../../../shared/test-fixtures/markdown-report.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { useTextSelection } from "../../hooks/useTextSelection.js";
import { useStore } from "../../store.js";
import { MessageBubble } from "../MessageBubble.js";
import { ComposerAnnotations } from "../ComposerAnnotations.js";
import { SelectionContextMenu } from "../SelectionContextMenu.js";

const report = makeMarkdownReportFixture();
const [message] = normalizeHistoryMessageToChatMessages(report, 0);

export function PlaygroundMarkdownReportSection() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const selection = useTextSelection({ current: root });
  const draft = useStore((state) => state.composerDrafts.get(report.source.sessionId));
  return (
    <section id="markdown-reports" className="space-y-4 scroll-mt-24" data-testid="playground-markdown-reports">
      <h2 className="text-lg font-semibold">Saved Markdown reports</h2>
      <p className="text-sm text-cc-muted">
        Select a passage to add a comment. Comments go to this session. This preview does not send messages.
      </p>
      <div ref={setRoot} data-annotation-preview-session={report.source.sessionId} className="space-y-3">
        <div data-message-id={report.id} data-message-role="assistant">
          <MessageBubble message={message} sessionId={report.source.sessionId} />
        </div>
        <SelectionContextMenu selection={selection} sessionId={report.source.sessionId} onClose={selection.dismiss} />
        <ComposerAnnotations sessionId={report.source.sessionId} threadKey={report.threadKey} />
        {draft?.annotations?.length ? (
          <p className="text-xs text-cc-muted">{draft.annotations.length} saved comment(s).</p>
        ) : null}
      </div>
    </section>
  );
}
