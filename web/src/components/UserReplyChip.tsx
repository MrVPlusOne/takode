import { useCallback } from "react";

/** Read-only reply chip shown above user message bubbles when the user replied to a specific assistant message. */
export function UserReplyChip({ previewText, messageId }: { previewText: string; messageId?: string }) {
  const handleClick = useCallback(() => {
    if (!messageId) return;
    const target = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief highlight flash
    target.classList.add("reply-highlight-flash");
    setTimeout(() => target.classList.remove("reply-highlight-flash"), 1500);
  }, [messageId]);

  return (
    <div
      className={`flex items-center gap-1.5 mb-1.5 text-[11px] text-cc-muted/80 max-w-full min-w-0${messageId ? " cursor-pointer hover:text-cc-muted transition-colors" : ""}`}
      onClick={messageId ? handleClick : undefined}
      role={messageId ? "button" : undefined}
      title={messageId ? "Scroll to original message" : undefined}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        className="w-3 h-3 shrink-0 text-cc-primary/60"
      >
        <path d="M6 3L2 7l4 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 7h7a4 4 0 014 4v1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{previewText}</span>
    </div>
  );
}
