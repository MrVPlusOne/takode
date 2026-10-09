import { useEffect, useState } from "react";
import type { ServerRestartPhase } from "../store-types.js";

const PHASE_COPY: Record<ServerRestartPhase, { title: string; detail: string }> = {
  preparing: {
    title: "Preparing restart",
    detail:
      "Checking the new server code, building the frontend and stopping running turns. The current server keeps running until this finishes, which can take a minute.",
  },
  restarting: {
    title: "Restarting server",
    detail: "Waiting for the new server to start. Sessions reconnect on demand after it is back.",
  },
  reloading: {
    title: "Server is back",
    detail: "Reloading this page to load the new build.",
  },
};

const PHASE_STEPS: Array<{ phase: ServerRestartPhase; label: string }> = [
  { phase: "preparing", label: "Prepare" },
  { phase: "restarting", label: "Restart" },
  { phase: "reloading", label: "Reload" },
];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Full-screen progress for a Restart Server request made from this tab. */
export function ServerRestartOverlay({ phase }: { phase: ServerRestartPhase }) {
  // The overlay stays mounted across phases, so elapsed time counts from the click.
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const copy = PHASE_COPY[phase];
  const currentStep = PHASE_STEPS.findIndex((step) => step.phase === phase);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      data-testid="server-restart-overlay"
    >
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-sm bg-cc-card border border-cc-border rounded-xl p-6 text-center"
      >
        <div className="animate-spin w-8 h-8 border-2 border-cc-primary border-t-transparent rounded-full mx-auto mb-4" />
        <h2 className="text-sm font-semibold text-cc-fg">{copy.title}</h2>
        <p className="mt-2 text-xs text-cc-muted">{copy.detail}</p>
        <ol className="mt-4 flex items-center justify-center gap-2 text-[11px]" aria-label="Restart steps">
          {PHASE_STEPS.map((step, index) => (
            <li
              key={step.phase}
              aria-current={index === currentStep ? "step" : undefined}
              className={`px-2 py-0.5 rounded-full border ${
                index === currentStep
                  ? "border-cc-primary/60 text-cc-fg bg-cc-primary/10"
                  : "border-cc-border text-cc-muted"
              }`}
            >
              {index < currentStep ? `✓ ${step.label}` : step.label}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] font-mono text-cc-muted">Elapsed {formatElapsed(now - startedAt)}</p>
      </div>
    </div>
  );
}
