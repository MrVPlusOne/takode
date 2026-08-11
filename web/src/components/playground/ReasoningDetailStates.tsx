import type { ChatMessage } from "../../types.js";
import { CodexReasoningDetail } from "../CodexReasoningDetail.js";

function reasoningMessage(id: string, content: string, status: "streaming" | "complete"): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: Date.now(),
    metadata: { codexReasoningDetail: { status } },
  };
}

const titled = reasoningMessage(
  "playground-reasoning-titled",
  "**Inspecting route metadata**\n\nThe complete official summary remains available on expansion without truncation.",
  "complete",
);

export function PlaygroundReasoningDetailStates() {
  const states: Array<{ label: string; messages: ChatMessage[]; defaultOpen?: boolean }> = [
    { label: "Collapsed title", messages: [titled] },
    { label: "Expanded detail", messages: [titled], defaultOpen: true },
    {
      label: "Titleless fallback",
      messages: [
        reasoningMessage(
          "playground-reasoning-titleless",
          "This official summary has no parseable provider title and uses the generic collapsed label.",
          "complete",
        ),
      ],
    },
    {
      label: "Streaming in place",
      messages: [
        reasoningMessage(
          "playground-reasoning-streaming",
          "**Checking live state**\n\nThe same chronological row is still receiving provider summary text.",
          "streaming",
        ),
      ],
    },
    {
      label: "Three producer summary parts",
      messages: [
        reasoningMessage("playground-reasoning-part-0", "**Addressing BugPilot Issues**\n\nFirst body.", "complete"),
        reasoningMessage("playground-reasoning-part-1", "**Planning Cluster Access**\n\nSecond body.", "complete"),
        reasoningMessage("playground-reasoning-part-2", "**Requesting Worker Details**\n\nThird body.", "complete"),
      ],
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {states.map((state) => (
        <div key={state.label} className="rounded-md border border-cc-border bg-cc-bg p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">{state.label}</div>
          <div className="space-y-2">
            {state.messages.map((message) => (
              <CodexReasoningDetail key={message.id} message={message} defaultOpen={state.defaultOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
