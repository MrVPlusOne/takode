import { useStore } from "../store.js";
import {
  reportInputGlitch,
  useInputTraceRecording,
  useInputTraceSaveStatus,
  useLastInputGlitchReport,
} from "../utils/input-trace.js";
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
  const lastSave = useInputTraceSaveStatus();
  const hidden = isRowHidden("input-trace");
  return (
    <div className="space-y-2" hidden={hidden}>
      <SettingsToggle
        label="Input trace"
        description={
          <>
            Automatically sends key presses, pastes and focus changes to this Takode server while on. Each page's latest
            hour is saved, up to 10,000 events, so an agent can investigate even after a reload. It never records what
            you type or paste: letters show up only as "a character" and text only as its length. Turning this off stops
            recording; automatically saved events expire from the available window after an hour.
          </>
        }
        checked={diagnostics.inputTrace}
        onChange={(inputTrace) => setDiagnostics({ ...diagnostics, inputTrace })}
      />
      {diagnostics.inputTrace && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs text-cc-muted">
          <span role="status">
            {lastSave?.error
              ? `Automatic save failed; retrying: ${lastSave.error}`
              : lastSave
                ? `Automatically saved at ${new Date(lastSave.at).toLocaleTimeString()}.`
                : "Recording; new activity saves automatically."}
          </span>
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
                : "Optional: save a snapshot in the server log, also available as a shortcut under Keyboard. Agents can read automatic recordings with takode input-trace."}
          </span>
        </div>
      )}
    </div>
  );
}
