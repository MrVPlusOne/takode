import { useState } from "react";
import { VoiceRecordingStatus } from "../VoiceRecordingStatus.js";
import type { VoiceMicrophone } from "../../utils/voice-microphone.js";
import { Card } from "./shared.js";

const inputs = [
  { deviceId: "usb", label: "USB Microphone" },
  { deviceId: "display", label: "Studio Display Microphone" },
  { deviceId: "built-in", label: "Built-in Microphone" },
];

/** Fixture-only picks show the real menu without requesting a mic or changing saved preferences. */
export function PlaygroundMicrophonePicker() {
  const [current, setCurrent] = useState(inputs[0]);
  const [order, setOrder] = useState<VoiceMicrophone[]>([inputs[0]]);
  const [nextRecording, setNextRecording] = useState(false);
  return (
    <Card label="Recording microphone picker and learned order">
      <div data-testid="playground-microphone-picker" className="space-y-3">
        <VoiceRecordingStatus
          currentLevel={0.4}
          samples={[]}
          inputDeviceLabel={current.label}
          microphoneSelection={{
            inputs,
            refresh: async () => {},
            select: async (microphone) => {
              setOrder((previous) => [microphone, ...previous.filter((item) => item.deviceId !== microphone.deviceId)]);
              if (nextRecording) return "next-recording";
              setCurrent(microphone);
              return "switched";
            },
          }}
        />
        <p className="text-xs text-cc-muted">
          Remembered order: {order.map((microphone) => microphone.label).join(" → ")}
        </p>
        <label className="flex items-center gap-2 text-xs text-cc-muted">
          <input type="checkbox" checked={nextRecording} onChange={(event) => setNextRecording(event.target.checked)} />
          Preview next-recording fallback
        </label>
      </div>
    </Card>
  );
}
