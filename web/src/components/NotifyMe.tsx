import { useState } from "react";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import { useStore } from "../store.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";

export function NotifyMeIcon({
  pending = false,
  monitored = true,
  className = "h-3 w-3",
}: {
  pending?: boolean;
  monitored?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 ${pending ? "text-cc-info" : "text-cc-muted"}`}
      title={
        !monitored
          ? "Notify Me: get notified about new results"
          : pending
            ? "Notify Me: result waiting"
            : "Notify Me is on"
      }
      role="img"
      aria-label={!monitored ? "Notify Me" : pending ? "Monitored task has a result waiting" : "Monitored task"}
    >
      <svg
        className={className}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.7" />
        <circle cx="8" cy="8" r="2.6" />
        <path d="M8 8 12.8 3.2" />
        {pending && <circle cx="12.5" cy="3.5" r="2.3" fill="currentColor" stroke="var(--color-cc-bg)" />}
      </svg>
    </span>
  );
}

export function NotifyMeControlView({
  enabled,
  pending,
  disabled,
  error,
  onToggle,
  onAcknowledge,
}: {
  enabled: boolean;
  pending: boolean;
  disabled?: boolean;
  error?: string | null;
  onToggle: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-testid="notify-me-control">
      <button
        type="button"
        aria-label={pending ? "Acknowledge" : "Notify Me"}
        aria-pressed={pending ? undefined : enabled}
        disabled={disabled}
        onClick={pending ? onAcknowledge : onToggle}
        title={
          pending
            ? "Acknowledge this result and keep tracking"
            : enabled
              ? "Notify Me: Stop tracking this task"
              : "Notify Me: Keep new results until you acknowledge or reply"
        }
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded px-1 text-[11px] transition-colors cursor-pointer hover:bg-cc-hover focus-visible:outline focus-visible:outline-cc-primary disabled:opacity-50 ${enabled ? "text-cc-info" : "text-cc-muted hover:text-cc-fg"}`}
      >
        <NotifyMeIcon pending={pending} monitored={enabled} />
        {pending ? "Acknowledge" : "Notify"}
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-cc-error">
          {error}
        </span>
      )}
    </span>
  );
}

export function NotifyMeControl({ sessionId, threadKey }: { sessionId: string; threadKey: string }) {
  const projection = useStore((state) => getSyncedProjectionValue(state, THREAD_MONITORING_PROJECTION, sessionId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!/^q-\d+$/.test(threadKey)) return null;
  const monitor = projection?.threads[threadKey];
  async function act(action: "track" | "untrack" | "acknowledge") {
    setBusy(true);
    setError(null);
    try {
      await updateThreadMonitoring(sessionId, threadKey, action, monitor?.pendingResultId ?? undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please retry");
    } finally {
      setBusy(false);
    }
  }
  return (
    <NotifyMeControlView
      enabled={Boolean(monitor)}
      pending={Boolean(monitor?.pendingResultId)}
      disabled={!projection || busy}
      error={error}
      onToggle={() => void act(monitor ? "untrack" : "track")}
      onAcknowledge={() => void act("acknowledge")}
    />
  );
}
