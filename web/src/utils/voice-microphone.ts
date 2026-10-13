export interface PreferredMicrophone {
  deviceId: string;
  label: string;
}

// Device IDs belong to this browser and origin, not to the Takode server or user account.
const PREFERENCE_KEY = "cc-preferred-microphone";
const knownInputs = new WeakMap<MediaDevices, MediaDeviceInfo[]>();

/** Reads this browser's preference; unavailable storage leaves system-follow enabled. */
export function getPreferredMicrophone(): PreferredMicrophone | null {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
    return value && typeof value.deviceId === "string" && value.deviceId && typeof value.label === "string"
      ? value
      : null;
  } catch (error) {
    console.warn("Could not read microphone preference", error);
    return null;
  }
}

/** Saves a browser-local preference, or restores system-follow. Storage failures reach the caller. */
export function setPreferredMicrophone(preference: PreferredMicrophone | null): void {
  if (preference) localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
  else localStorage.removeItem(PREFERENCE_KEY);
}

/** Chooses synchronously so recording never awaits device enumeration before requesting permission. */
export function getVoiceCaptureDeviceId(): string {
  const preference = getPreferredMicrophone();
  if (!preference) return "default";
  const inputs = knownInputs.get(navigator.mediaDevices);
  return !inputs || inputs.some((device) => device.deviceId === preference.deviceId) ? preference.deviceId : "default";
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
