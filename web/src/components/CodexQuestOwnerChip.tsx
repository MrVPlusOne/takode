import { useState, type MouseEvent } from "react";
import type { QuestOwnerRef } from "../../shared/quest-owner.js";
import { writeClipboardText } from "../utils/copy-utils.js";

export function CodexQuestOwnerChip({
  owner,
  className = "",
  stopPropagation = false,
}: {
  owner: QuestOwnerRef;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (owner.kind !== "codex") return null;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) event.stopPropagation();
    void writeClipboardText(owner.sessionId)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(console.error);
  }

  const shortId = owner.sessionId.length > 12 ? `${owner.sessionId.slice(0, 8)}\u2026` : owner.sessionId;
  return (
    <button
      type="button"
      data-testid="codex-quest-owner-chip"
      className={`inline-flex max-w-full items-center gap-1 rounded-md border border-cc-border bg-cc-hover/40 px-1.5 py-0.5 font-mono-code text-[10px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg ${className}`}
      aria-label={`Copy Codex task ID ${owner.sessionId}`}
      title={copied ? "Copied Codex task ID" : `Copy Codex task ID ${owner.sessionId}`}
      onKeyDown={(event) => {
        if (stopPropagation && (event.key === "Enter" || event.key === " ")) event.stopPropagation();
      }}
      onClick={handleClick}
    >
      <span className="font-sans">Codex</span>
      <span className="truncate">{copied ? "Copied" : shortId}</span>
    </button>
  );
}
