import type { ReactNode, Ref } from "react";

/** Count chip in the sessions-panel quick-action row (needs input, Notify Me, Quests). */
export function PanelChip({
  ref,
  onClick,
  icon,
  label,
  tone,
  grow = false,
  ariaLabel,
}: {
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
  icon: ReactNode;
  label: ReactNode;
  tone?: "attention" | "info";
  grow?: boolean;
  ariaLabel?: string;
}) {
  const toneClass =
    tone === "attention"
      ? "border-cc-attention-border bg-cc-attention-bg text-cc-attention hover:bg-cc-attention-bg/80"
      : tone === "info"
        ? "border-cc-info/40 bg-cc-info/10 text-cc-info hover:bg-cc-info/15"
        : "border-cc-border text-cc-fg/85 hover:bg-cc-hover";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium tabular-nums transition-colors cursor-pointer ${toneClass} ${grow ? "flex-1" : "shrink-0"}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
