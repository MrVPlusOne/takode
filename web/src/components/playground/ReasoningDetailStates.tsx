import type { ReactNode } from "react";
import type { ChatMessage } from "../../types.js";
import { CodexReasoningDetail, CodexReasoningDetailGroup } from "../CodexReasoningDetail.js";

function reasoningMessage(id: string, content: string, status: "streaming" | "complete"): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: Date.now(),
    metadata: { codexReasoningDetail: { status, reasoningTurnId: "playground-turn" } },
  };
}

const titled = reasoningMessage(
  "playground-reasoning-titled",
  "**Inspecting route metadata**\n\nThe complete official summary remains available on expansion without truncation.",
  "complete",
);

const producerParts = [
  reasoningMessage("playground-reasoning-part-0", "**Addressing review feedback**\n\nFirst body.", "complete"),
  reasoningMessage("playground-reasoning-part-1", "**Planning validation coverage**\n\nSecond body.", "complete"),
  reasoningMessage("playground-reasoning-part-2", "**Preparing the final handoff**\n\nThird body.", "complete"),
];

export function PlaygroundReasoningDetailStates() {
  const states: Array<{ label: string; content: ReactNode }> = [
    { label: "Collapsed title", content: <CodexReasoningDetail message={titled} /> },
    { label: "Expanded detail", content: <CodexReasoningDetail message={titled} defaultOpen /> },
    {
      label: "Titleless fallback",
      content: (
        <CodexReasoningDetail
          message={reasoningMessage(
            "playground-reasoning-titleless",
            "This official summary has no parseable provider title and uses the generic collapsed label.",
            "complete",
          )}
        />
      ),
    },
    {
      label: "Streaming in place",
      content: (
        <CodexReasoningDetail
          message={reasoningMessage(
            "playground-reasoning-streaming",
            "**Checking live state**\n\nThe same chronological row is still receiving provider summary text.",
            "streaming",
          )}
        />
      ),
    },
    {
      label: "Grouped collapsed",
      content: <CodexReasoningDetailGroup messages={producerParts} />,
    },
    {
      label: "Grouped expanded",
      content: <CodexReasoningDetailGroup messages={producerParts} defaultOpen />,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {states.map((state) => (
        <div key={state.label} className="rounded-md border border-cc-border bg-cc-bg p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">{state.label}</div>
          {state.content}
        </div>
      ))}
    </div>
  );
}
