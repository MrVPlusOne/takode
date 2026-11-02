import { reportInputGlitch, useInputTraceRecording, useLastInputGlitchReport } from "../utils/input-trace.js";

/**
 * The sidebar's "Report input glitch" button. It shows only while the input trace (Settings >
 * Diagnostics) is recording, which also tells the user the trace is on.
 */
export function ReportInputGlitchButton() {
  const recording = useInputTraceRecording();
  const lastReport = useLastInputGlitchReport();
  if (!recording) return null;
  const title =
    lastReport && "error" in lastReport
      ? `Report input glitch (the last report failed: ${lastReport.error})`
      : lastReport
        ? `Report input glitch (last sent ${new Date(lastReport.at).toLocaleTimeString()})`
        : "Report input glitch: send the last hour of input activity to the server log";
  return (
    <button
      type="button"
      title={title}
      aria-label="Report input glitch"
      onClick={() => reportInputGlitch()}
      className="p-2 rounded-lg transition-colors cursor-pointer text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
        <path d="M4 6.5h1M7.5 6.5h1M11 6.5h1M5 9.5h6" strokeLinecap="round" />
        <circle cx="13" cy="3" r="2" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
