import { useStore } from "../store.js";
import { reportInputGlitch, useInputTraceRecording, useLastInputGlitchReport } from "../utils/input-trace.js";
import { SettingsToggle } from "./settings-controls.js";

/**
 * Settings > Diagnostics: recordings that help developers find bugs, each off until the user
 * turns it on. A new diagnostic gets its own toggle here and its own field in
 * `shared/diagnostics-settings.ts`.
 */
export function SettingsDiagnosticsSection({ isRowHidden }: { isRowHidden: (itemId: string) => boolean }) {
  const diagnostics = useStore((s) => s.diagnostics);
  const setDiagnostics = useStore((s) => s.setDiagnostics);
  const recording = useInputTraceRecording();
  const lastReport = useLastInputGlitchReport();
  const hidden = isRowHidden("input-trace");
  return (
    <div className="space-y-2" hidden={hidden}>
      <SettingsToggle
        label="Input trace"
        description={
          <>
            Keeps the last hour of key presses, pastes and focus changes in this browser's memory, so a glitch such as a
            paste that didn't land can be reported right after it happens. It never records what you type or paste:
            letters show up only as "a character" and text only as its length. Nothing leaves the browser until you
            report a glitch, and turning this off forgets the record.
          </>
        }
        checked={diagnostics.inputTrace}
        onChange={(inputTrace) => setDiagnostics({ ...diagnostics, inputTrace })}
      />
      {diagnostics.inputTrace && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs text-cc-muted">
          <button
            type="button"
            disabled={!recording}
            onClick={() => reportInputGlitch()}
            className="rounded-lg bg-cc-hover px-3 py-1.5 text-sm text-cc-fg transition-colors hover:bg-cc-active disabled:cursor-wait disabled:opacity-60 cursor-pointer"
          >
            Report input glitch
          </button>
          <span>
            {lastReport && "error" in lastReport
              ? `Could not send the report: ${lastReport.error}`
              : lastReport
                ? `Sent ${lastReport.eventCount} events at ${new Date(lastReport.at).toLocaleTimeString()}.`
                : "Also a keyboard shortcut you can set under Keyboard. A report goes to the server log; ask an agent to read it (takode logs --component input-trace)."}
          </span>
        </div>
      )}
    </div>
  );
}
