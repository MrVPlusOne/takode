import { useRef, useState } from "react";
import type { ChatMessage } from "../../types.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MessageBubble } from "../MessageBubble.js";
import { SelectionContextMenu } from "../SelectionContextMenu.js";
import { useTextSelection } from "../../hooks/useTextSelection.js";
import { useStore } from "../../store.js";
import { Card, Section } from "./shared.js";

const MATH_MESSAGE: ChatMessage = {
  id: "playground-markdown-math-message",
  role: "assistant",
  timestamp: 0,
  content:
    "Inline dollar math $x_i + y_i$ and compatible backslash math \\(s\\).\n\n" +
    "Display dollar math:\n\n$$\\frac{s-1}{6}$$\n\n" +
    "Stored assistant form:\n\n\\[\n\\left(\\frac{s}{7}\\right)^2\n\\]",
};

const WIDE_FORMULA = String.raw`\[
\begin{aligned}
W(\theta) &= \frac{\alpha_1 x_1 + \alpha_2 x_2 + \alpha_3 x_3 + \alpha_4 x_4 + \alpha_5 x_5 + \alpha_6 x_6 + \alpha_7 x_7 + \alpha_8 x_8 + \alpha_9 x_9 + \alpha_{10} x_{10}}{\sqrt{\sigma_1^2 + \sigma_2^2 + \sigma_3^2 + \sigma_4^2 + \sigma_5^2}} \\
&\quad + \sum_{i=1}^{24} \alpha_i \left(\frac{x_i - \mu_i}{\sigma_i}\right)^2
+ \lambda \prod_{j=1}^{16}\left(1 + \frac{\beta_j}{1 + e^{-z_j}}\right)
\end{aligned}
\]`;

const WIDE_INLINE_FORMULA = String.raw`A long inline formula \(\displaystyle \prod_{j=1}^{32}\left(1 + \frac{\beta_j}{1 + e^{-z_j}}\right) + \sum_{i=1}^{48}\alpha_i x_i\) stays inside its message.`;

const MATH_SELECTION_SESSION_ID = "playground-markdown-math-selection";

function PlaygroundMathSelectionDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const selection = useTextSelection(containerRef);
  const quotedDraft = useStore((state) => state.composerDrafts.get(MATH_SELECTION_SESSION_ID)?.text ?? "");

  return (
    <div ref={containerRef} className="space-y-2">
      <div data-message-id="playground-math-selection-message" data-message-role="assistant">
        <MarkdownContent
          text={String.raw`Select inside this formula: \(x_i + y_i\).`}
          data-testid="playground-math-selection-source"
          enableChatSelectionMenu
        />
      </div>
      <div
        data-testid="playground-math-quote-draft"
        className="min-h-8 rounded-md border border-cc-border bg-cc-bg px-2 py-1.5 font-mono-code text-xs text-cc-muted whitespace-pre-wrap"
      >
        {quotedDraft || "Quoted source appears here."}
      </div>
      <SelectionContextMenu selection={selection} sessionId={MATH_SELECTION_SESSION_ID} onClose={selection.dismiss} />
    </div>
  );
}

export function PlaygroundMarkdownMathSection() {
  const [streamComplete, setStreamComplete] = useState(false);

  return (
    <Section
      title="Markdown Math"
      description="Shared Markdown renders accessible, source-faithful KaTeX while keeping malformed source readable and wide formulas locally scrollable."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Assistant message — inline and display delimiter compatibility">
          <MessageBubble message={MATH_MESSAGE} sessionId="playground-markdown-math" />
        </Card>
        <Card label="Wide display math — constrained mobile-width surface">
          <div className="w-full max-w-[430px] min-w-0 space-y-3 rounded-lg border border-cc-border bg-cc-bg p-3">
            <MarkdownContent text={WIDE_INLINE_FORMULA} data-testid="playground-wide-inline-math" />
            <MarkdownContent text={WIDE_FORMULA} data-testid="playground-wide-math" />
          </div>
        </Card>
        <Card label="Rendered selection — copy and quote use one source token">
          <PlaygroundMathSelectionDemo />
        </Card>
        <Card label="Malformed, unsupported, and streaming delimiter states">
          <div className="space-y-3">
            <MarkdownContent text={String.raw`Readable fallback: \(\notARealCommand{x}\) and unmatched \[source.`} />
            <button
              type="button"
              className="rounded-md border border-cc-border bg-cc-hover px-2.5 py-1 text-xs text-cc-fg"
              onClick={() => setStreamComplete((current) => !current)}
            >
              Toggle streaming delimiter
            </button>
            <div data-testid="playground-streaming-math" data-stream-complete={streamComplete ? "true" : "false"}>
              <MarkdownContent
                text={streamComplete ? String.raw`Streaming: \(x + 1\)` : String.raw`Streaming: \(x +`}
              />
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}
