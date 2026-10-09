import type { ReactNode, Ref } from "react";

/** Large count-and-label button for the phone sessions-panel shortcut row. */
export function ShortcutTile({
  ref,
  onClick,
  icon,
  count,
  label,
  tone,
  ariaLabel,
}: {
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
  icon: ReactNode;
  count?: number;
  label: string;
  tone?: "attention" | "info";
  ariaLabel?: string;
}) {
  const toneClass =
    tone === "attention"
      ? "border-cc-attention-border bg-cc-attention-bg text-cc-attention"
      : tone === "info"
        ? "border-cc-info/40 bg-cc-info/10 text-cc-info"
        : "border-cc-border bg-cc-card text-cc-fg/85";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={`flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border transition-colors cursor-pointer ${toneClass}`}
    >
      <span className="flex items-center gap-1 text-[15px] font-semibold tabular-nums">
        {icon}
        {count}
      </span>
      <span className="max-w-full truncate text-[11px] font-medium tracking-tight">{label}</span>
    </button>
  );
}
