import { useStore } from "../store.js";
import { useUsageLimits } from "../hooks/useUsageLimits.js";

function barColor(pct: number): string {
  if (pct > 80) return "bg-cc-error";
  if (pct > 50) return "bg-cc-warning";
  return "bg-cc-primary";
}

function formatResetTime(resetsAt: string): string {
  try {
    const diffMs = new Date(resetsAt).getTime() - Date.now();
    if (diffMs <= 0) return "now";
    const hours = Math.floor(diffMs / 3_600_000);
    const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return "";
  }
}

function UsageRow({ label, pct, resetStr }: { label: string; pct: number; resetStr: string }) {
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label} Limit: ${pct}%${resetStr ? ` (resets in ${resetStr})` : ""}`}
    >
      <span className="text-[9px] text-cc-muted uppercase tracking-wider font-medium w-4 text-right">
        {label}
      </span>
      <div className="flex-1 h-1 rounded-full bg-cc-hover overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[9px] text-cc-muted tabular-nums">{pct}%</span>
    </div>
  );
}

export function SidebarUsageBar() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const showUsageBars = useStore((s) => s.showUsageBars);
  const limits = useUsageLimits(currentSessionId);

  if (!showUsageBars || !limits) return null;

  const fiveHour = limits.five_hour;
  const sevenDay = limits.seven_day;
  const extra = limits.extra_usage;

  const rows: { label: string; pct: number; resetStr: string }[] = [];

  if (fiveHour) {
    rows.push({
      label: "5H",
      pct: fiveHour.utilization,
      resetStr: fiveHour.resets_at ? formatResetTime(fiveHour.resets_at) : "",
    });
  }
  if (sevenDay) {
    rows.push({
      label: "7D",
      pct: sevenDay.utilization,
      resetStr: sevenDay.resets_at ? formatResetTime(sevenDay.resets_at) : "",
    });
  }
  if (rows.length === 0 && extra?.is_enabled && extra.utilization !== null) {
    rows.push({ label: "Extra", pct: extra.utilization, resetStr: "" });
  }

  if (rows.length === 0) return null;

  return (
    <div className="px-3 pb-1.5 space-y-1">
      {rows.map((r) => (
        <UsageRow key={r.label} label={r.label} pct={r.pct} resetStr={r.resetStr} />
      ))}
    </div>
  );
}
