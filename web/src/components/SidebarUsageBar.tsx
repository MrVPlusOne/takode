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

export function SidebarUsageBar() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const limits = useUsageLimits(currentSessionId);

  if (!limits) return null;

  // Pick the highest-urgency limit to display
  const fiveHour = limits.five_hour;
  const sevenDay = limits.seven_day;

  // Determine which limit to show (highest utilization first)
  let label = "";
  let pct = 0;
  let resetStr = "";

  if (fiveHour && sevenDay) {
    // Show whichever is higher
    if (fiveHour.utilization >= sevenDay.utilization) {
      label = "5H";
      pct = fiveHour.utilization;
      resetStr = fiveHour.resets_at ? formatResetTime(fiveHour.resets_at) : "";
    } else {
      label = "7D";
      pct = sevenDay.utilization;
      resetStr = sevenDay.resets_at ? formatResetTime(sevenDay.resets_at) : "";
    }
  } else if (fiveHour) {
    label = "5H";
    pct = fiveHour.utilization;
    resetStr = fiveHour.resets_at ? formatResetTime(fiveHour.resets_at) : "";
  } else if (sevenDay) {
    label = "7D";
    pct = sevenDay.utilization;
    resetStr = sevenDay.resets_at ? formatResetTime(sevenDay.resets_at) : "";
  } else if (limits.extra_usage?.is_enabled && limits.extra_usage.utilization !== null) {
    label = "Extra";
    pct = limits.extra_usage.utilization;
  } else {
    return null;
  }

  return (
    <div
      className="px-3 pb-2"
      title={`${label} Limit: ${pct}%${resetStr ? ` (resets in ${resetStr})` : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-cc-muted uppercase tracking-wider font-medium">
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
    </div>
  );
}
