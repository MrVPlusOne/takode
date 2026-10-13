export interface VoiceMicrophone {
  deviceId: string;
  label: string;
}

export interface VoiceMicrophoneSelection {
  inputs: VoiceMicrophone[];
  refresh: () => Promise<void>;
  select: (microphone: VoiceMicrophone) => Promise<"switched" | "next-recording">;
}

// Device IDs belong to this browser and origin, not to the Takode server or user account.
const ORDER_KEY = "cc-microphone-order";
const LEGACY_PREFERENCE_KEY = "cc-preferred-microphone";
const ORDER_CHANGED = "voice-microphone-order-changed";
const knownInputs = new WeakMap<MediaDevices, MediaDeviceInfo[]>();

/** Reads this browser's learned order, including a prior single preference until the next save. */
export function getMicrophoneOrder(): VoiceMicrophone[] {
  try {
    const order = localStorage.getItem(ORDER_KEY);
    const value = JSON.parse(order ?? localStorage.getItem(LEGACY_PREFERENCE_KEY) ?? "[]");
    return (Array.isArray(value) ? value : [value]).filter(isVoiceMicrophone);
  } catch (error) {
    console.warn("Could not read microphone preference", error);
    return [];
  }
}

/** Promotes an explicit pick without losing the order of other, including disconnected, microphones. */
export function rememberMicrophone(microphone: VoiceMicrophone): void {
  saveMicrophoneOrder([
    { deviceId: microphone.deviceId, label: microphone.label },
    ...getMicrophoneOrder().filter((entry) => entry.deviceId !== microphone.deviceId),
  ]);
}

/** Restores system-follow and clears the old single-preference setting too. */
export function resetMicrophoneOrder(): void {
  saveMicrophoneOrder([]);
}

/** Watches saved order changes in this tab and other tabs at the same origin. */
export function watchMicrophoneOrder(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === ORDER_KEY || event.key === LEGACY_PREFERENCE_KEY) onChange();
  };
  window.addEventListener(ORDER_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ORDER_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns connected choices in learned order, without awaiting a permission-sensitive device probe. */
export function getVoiceCaptureDeviceIds(): string[] {
  const inputs = knownInputs.get(navigator.mediaDevices);
  return getMicrophoneOrder()
    .filter((entry) => !inputs || inputs.some((device) => device.deviceId === entry.deviceId))
    .map((entry) => entry.deviceId);
}

/** Chooses synchronously so recording never awaits device enumeration before requesting permission. */
export function getVoiceCaptureDeviceId(): string {
  return getVoiceCaptureDeviceIds()[0] ?? "default";
}

function isVoiceMicrophone(value: unknown): value is VoiceMicrophone {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VoiceMicrophone>;
  return (
    typeof entry.deviceId === "string" &&
    !!entry.deviceId &&
    !["default", "communications"].includes(entry.deviceId) &&
    typeof entry.label === "string"
  );
}

function saveMicrophoneOrder(order: VoiceMicrophone[]): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  localStorage.removeItem(LEGACY_PREFERENCE_KEY);
  window.dispatchEvent(new Event(ORDER_CHANGED));
}

/** Refreshes the available physical microphones without opening the mic or prompting for permission. */
export async function listVoiceMicrophones(): Promise<MediaDeviceInfo[]> {
  const mediaDevices = navigator.mediaDevices;
  const inputs = (await mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  // Before permission, browsers hide IDs/labels and often return only one unnamed device.
  // Such a list cannot tell us that a saved device is disconnected.
  if (inputs.some((device) => device.deviceId && device.label)) knownInputs.set(mediaDevices, inputs);
  else knownInputs.delete(mediaDevices);
  return inputs.filter(
    (device) => device.deviceId && device.label && !["default", "communications"].includes(device.deviceId),
  );
}

/** Keeps availability current without putting an asynchronous probe in the recording click. */
export function watchVoiceMicrophones(
  onChange: (inputs: MediaDeviceInfo[]) => void,
  onError: (error: unknown) => void,
): () => void {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return () => {};
  let active = true;
  const refresh = () => {
    void listVoiceMicrophones().then(
      (inputs) => {
        if (active) onChange(inputs);
      },
      (error) => {
        if (active) onError(error);
      },
    );
  };
  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  refresh();
  mediaDevices.addEventListener?.("devicechange", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  return () => {
    active = false;
    mediaDevices.removeEventListener?.("devicechange", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
  };
}
