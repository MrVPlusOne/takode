import type { ReactNode } from "react";

export function SubagentSectionHeader({
  label,
  open,
  onToggle,
  extra,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  extra?: ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-cc-hover/50 transition-colors cursor-pointer"
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className={`w-2.5 h-2.5 text-cc-muted transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
      <span className="text-[11px] font-medium text-cc-muted">{label}</span>
      {extra && <span className="ml-auto shrink-0">{extra}</span>}
    </button>
  );
}
