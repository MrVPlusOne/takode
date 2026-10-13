import { useEffect, useId, useState } from "react";
import {
  getPreferredMicrophone,
  listVoiceMicrophones,
  setPreferredMicrophone,
  watchVoiceMicrophones,
} from "../utils/voice-microphone.js";
import { requestVoiceCaptureStream } from "../hooks/useVoiceInput.js";

/** Browser-local microphone selection; device discovery requests permission only on a click. */
export function SettingsMicrophone() {
  const id = useId();
  const [preference, setPreference] = useState(getPreferredMicrophone);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.enumerateDevices;
  const missing = preference && !inputs.some((input) => input.deviceId === preference.deviceId);

  useEffect(() => watchVoiceMicrophones(setInputs, () => setError("Could not list microphones. Try again.")), []);

  async function revealMicrophones() {
    setLoading(true);
    setError("");
    let stream: MediaStream | undefined;
    try {
      // Request directly inside the click: WebKit only gives the first request gesture privilege.
      stream = await requestVoiceCaptureStream();
      setInputs(await listVoiceMicrophones());
    } catch (error) {
      setError(
        (error as { name?: string })?.name === "NotAllowedError"
          ? "Microphone access denied. Allow microphone access in your browser, then try again."
          : "Could not list microphones. Check the connection and try again.",
      );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 mb-5" data-settings-item-id="voice-microphone">
      <label htmlFor={id} className="block text-xs font-medium text-cc-muted">
        Preferred microphone
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          value={preference?.deviceId ?? ""}
          className="min-w-0 w-full sm:flex-1 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
          onChange={(event) => {
            const input = inputs.find((input) => input.deviceId === event.target.value);
            const next = input ? { deviceId: input.deviceId, label: input.label } : null;
            try {
              setPreferredMicrophone(next);
              setPreference(next);
              setError("");
            } catch {
              setError("Could not save microphone preference. Allow browser storage, then try again.");
            }
          }}
        >
          <option value="">Follow the system microphone</option>
          {missing && <option value={preference.deviceId}>{preference.label} (not currently listed)</option>}
          {inputs.map((input) => (
            <option key={input.deviceId} value={input.deviceId}>
              {input.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!supported || loading}
          onClick={revealMicrophones}
          className="px-3 py-2 text-xs font-medium border border-cc-border rounded-lg text-cc-fg hover:bg-cc-hover disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          {loading ? "Checking microphones…" : "Find microphones"}
        </button>
      </div>
      <p className="text-xs text-cc-muted">
        Uses your chosen mic when connected, otherwise the system microphone. Saved automatically in this browser only.
      </p>
      {supported && inputs.length === 0 && (
        <p className="text-xs text-cc-muted">Find microphones to allow access and show device names.</p>
      )}
      {!supported && (
        <p className="text-xs text-cc-muted">
          Microphone selection requires HTTPS or localhost and a supported browser.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-cc-error">
          {error}
        </p>
      )}
    </div>
  );
}
