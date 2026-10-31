import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

const fence = (body: string) => `\`\`\`visual\n${body}\n\`\`\``;

/** A kit visual: runs no code, so every device shows it as written. */
const KIT_MESSAGE: ChatMessage = {
  id: "playground-visual-kit",
  role: "assistant",
  timestamp: 0,
  content: `**The agents never talk to each other.** The server's lease and landing queue coordinate them:\n\n${fence(
    [
      "title: One landing run with two workers",
      "alt: Both workers submit and wait for the lease; the server gives it to A, whose landing run tests every waiting change once, pushes and tells both they landed.",
      "---",
      '<div class="tk-stats"><div class="tk-stat" data-tone="look"><b>2</b><span>workers waiting</span></div><div class="tk-stat" data-tone="checked"><b>1</b><span>test run</span></div></div>',
      '<div class="tk-flow tk-numbered"><div class="tk-stage"><h3>Submit</h3><div class="tk-sub">each worker</div></div><div class="tk-stage"><span class="tk-in">lease</span><h3>Land</h3><div class="tk-sub">stack, test once, push</div></div><div class="tk-stage" data-tone="checked"><h3>Landed</h3><div class="tk-sub">both hear it</div></div></div>',
    ].join("\n"),
  )}\n\nA failure bounces only the change that caused it.`,
};

/** Roles, a zone and a caption: one colour per actor, the way design walkthroughs draw architecture. */
const ROLES_MESSAGE: ChatMessage = {
  id: "playground-visual-roles",
  role: "assistant",
  timestamp: 0,
  content: fence(
    [
      "title: Who runs where",
      "alt: You use the browser on your laptop; on the DevBox the leader dispatches workers, and workers write memory notes.",
      "caption: Figure 1. One colour per actor, the same in every figure: you purple, leaders blue, workers orange, files teal.",
      "---",
      '<div class="tk-legend"><span data-role="purple">you</span><span data-role="blue">leader</span><span data-role="orange">workers</span><span data-role="teal">files</span></div>',
      '<div class="tk-flow"><div class="tk-zone" data-role="grey"><h4>Laptop</h4><div class="tk-box" data-role="purple"><h3>You</h3><div class="tk-sub">browser</div></div></div>',
      '<div class="tk-zone"><h4>DevBox</h4><div class="tk-flow tk-down"><div class="tk-box" data-role="blue"><h3>Leader</h3></div><div class="tk-box" data-role="orange"><span class="tk-in">dispatch</span><h3>Workers</h3></div></div></div>',
      '<div class="tk-box" data-role="teal"><span class="tk-in">writes</span><h3>Memory</h3><div class="tk-sub">git notes</div></div></div>',
    ].join("\n"),
  ),
};

/** A source over the size limit: shown as its plain-text version, never drawn. */
const TOO_LARGE_MESSAGE: ChatMessage = {
  id: "playground-visual-too-large",
  role: "assistant",
  timestamp: 0,
  content: fence(
    `title: An oversized table\nalt: Every row of the export, as a table.\n---\n<table>${"<tr><td>row</td></tr>".repeat(14000)}</table>`,
  ),
};

export function PlaygroundVisualBlocksSection() {
  return (
    <Section
      title="Visual Blocks"
      description="A ```visual fence: the agent's HTML with Takode's kit, in a sandboxed frame. Visuals load one at a time near the viewport; one that hangs or slows Takode is stopped and, on that device, shown as a still picture with Run. Diagram and chart helpers and the server's still pictures need the backend."
    >
      <Card label="Kit visual in an answer (no scripts)">
        <div className="max-w-[640px]" data-testid="playground-visual-kit">
          <MessageBubble message={KIT_MESSAGE} sessionId="playground-visuals" />
        </div>
      </Card>
      <Card label="Roles, a zone and a caption">
        <div className="max-w-[640px]" data-testid="playground-visual-roles">
          <MessageBubble message={ROLES_MESSAGE} sessionId="playground-visuals" />
        </div>
      </Card>
      <Card label="Too large to show: its plain-text version instead">
        <div className="max-w-[430px]" data-testid="playground-visual-too-large">
          <MessageBubble message={TOO_LARGE_MESSAGE} sessionId="playground-visuals" />
        </div>
      </Card>
    </Section>
  );
}
