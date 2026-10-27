import { formatExactMessageTimestamp } from "./MessageTimestamp.js";

export function MinuteBoundaryTimestamp({ timestamp, label }: { timestamp: number; label: string }) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <div className="flex items-center justify-center py-1">
      <time
        data-testid="minute-boundary-timestamp"
        data-feed-time={timestamp}
        data-feed-day-divider="true"
        dateTime={date.toISOString()}
        title={formatExactMessageTimestamp(timestamp)}
        className="text-[11px] text-cc-muted/70 font-mono-code"
      >
        {label}
      </time>
    </div>
  );
}
