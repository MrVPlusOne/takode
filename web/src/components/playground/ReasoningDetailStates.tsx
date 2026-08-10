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
  const states = [
    { label: "Collapsed title", message: titled },
    { label: "Expanded detail", message: titled, defaultOpen: true },
    {
      label: "Titleless fallback",
      message: reasoningMessage(
        "playground-reasoning-titleless",
        "This official summary has no parseable provider title and uses the generic collapsed label.",
        "complete",
      ),
    },
    {
      label: "Streaming in place",
      message: reasoningMessage(
        "playground-reasoning-streaming",
        "**Checking live state**\n\nThe same chronological row is still receiving provider summary text.",
        "streaming",
      ),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {states.map((state) => (
        <div key={state.label} className="rounded-md border border-cc-border bg-cc-bg p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">{state.label}</div>
          <CodexReasoningDetail message={state.message} defaultOpen={state.defaultOpen} />
        </div>
      ))}
    </div>
  );
}
