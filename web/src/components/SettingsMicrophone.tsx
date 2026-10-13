import { useEffect, useState } from "react";
import {
  getMicrophoneOrder,
  resetMicrophoneOrder,
  watchMicrophoneOrder,
  watchVoiceMicrophones,
} from "../utils/voice-microphone.js";

/** Shows the order learned from recording-row picks; choosing microphones happens only there. */
export function SettingsMicrophone() {
  const [order, setOrder] = useState(getMicrophoneOrder);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  useEffect(() => watchVoiceMicrophones(setInputs, () => setError("Could not check connected microphones.")), []);
  useEffect(() => watchMicrophoneOrder(() => setOrder(getMicrophoneOrder())), []);

  return (
    <div className="space-y-2 mb-5" data-settings-item-id="voice-microphone">
      <h3 className="text-xs font-medium text-cc-muted">Microphone order</h3>
      <p className="text-xs text-cc-muted">
        Tap the microphone name while recording to choose. Your latest pick goes first; voice input uses the first
        connected mic below, then the system mic.
      </p>
      {order.length ? (
        <ol className="list-decimal pl-5 space-y-1 text-sm text-cc-fg" aria-label="Remembered microphone order">
          {order.map((microphone) => (
            <li key={microphone.deviceId}>
              {microphone.label}
              {!inputs.some((input) => input.deviceId === microphone.deviceId) && (
                <span className="text-xs text-cc-muted"> (not currently listed)</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-cc-fg">Following the system microphone.</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-cc-muted">Remembered in this browser only.</p>
        <button
          type="button"
          disabled={!order.length}
          onClick={() => {
            try {
              resetMicrophoneOrder();
              setError("");
            } catch {
              setError("Could not reset microphone order. Allow browser storage and try again.");
            }
          }}
          className="shrink-0 rounded-lg border border-cc-border px-3 py-2 text-xs text-cc-fg hover:bg-cc-hover disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          Reset to system mic
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-cc-error">
          {error}
        </p>
      )}
    </div>
  );
}
