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
const HEADSET_CHOICE_KEY = "cc-microphone-with-headset";
const PHONE_MICROPHONE_KEY = "cc-phone-microphone";
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
    if (!event.key || watched.includes(event.key)) onChange();
  };
  const watched = [ORDER_KEY, LEGACY_PREFERENCE_KEY, HEADSET_CHOICE_KEY];
  window.addEventListener(ORDER_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ORDER_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Which mic records on a phone or tablet while a headset such as AirPods is connected. "phone"
 * asks for the device's own mic by its exact ID: WebKit then makes it the preferred input, so
 * iOS does not first switch the AirPods into call mode, which takes seconds. "headset" leaves
 * the choice to the system as before. Explicit picks in the recording row still come first.
 */
export type HeadsetMicrophoneChoice = "phone" | "headset";

export function getHeadsetMicrophoneChoice(): HeadsetMicrophoneChoice {
  return readStorage(HEADSET_CHOICE_KEY) === "headset" ? "headset" : "phone";
}

export function setHeadsetMicrophoneChoice(choice: HeadsetMicrophoneChoice): void {
  localStorage.setItem(HEADSET_CHOICE_KEY, choice);
  window.dispatchEvent(new Event(ORDER_CHANGED));
}

/** The phone's or tablet's own microphone, as iOS names it ("iPhone Microphone"). */
export function isPhoneMicrophoneLabel(label: string): boolean {
  return /^(iPhone|iPad)\b.*\bmicrophone\b/i.test(label);
}

/** Returns connected choices in learned order, without awaiting a permission-sensitive device probe. */
export function getVoiceCaptureDeviceIds(): string[] {
  const inputs = knownInputs.get(navigator.mediaDevices);
  const available = (deviceId: string) => !inputs || inputs.some((device) => device.deviceId === deviceId);
  const ids = getMicrophoneOrder()
    .filter((entry) => available(entry.deviceId))
    .map((entry) => entry.deviceId);
  // Remembered from an earlier listing, because before this page's first recording iOS hides
  // device names and IDs, and the first request must already ask for the phone's mic.
  const phone = getHeadsetMicrophoneChoice() === "phone" ? readPhoneMicrophone() : null;
  if (phone && available(phone.deviceId) && !ids.includes(phone.deviceId)) ids.push(phone.deviceId);
  return ids;
}

/** Where the next recording's first microphone request comes from, saved with its timing. */
export function getVoiceCaptureSource(): "picked" | "phone" | "system" {
  const first = getVoiceCaptureDeviceIds()[0];
  if (!first) return "system";
  return getMicrophoneOrder().some((entry) => entry.deviceId === first) ? "picked" : "phone";
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

function readPhoneMicrophone(): VoiceMicrophone | null {
  try {
    const value: unknown = JSON.parse(readStorage(PHONE_MICROPHONE_KEY) ?? "null");
    return isVoiceMicrophone(value) ? value : null;
  } catch (error) {
    console.warn("Could not read the remembered phone microphone", error);
    return null;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Could not read microphone settings", error);
    return null;
  }
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
  const phone = inputs.find((device) => device.deviceId && isPhoneMicrophoneLabel(device.label));
  if (phone && readPhoneMicrophone()?.deviceId !== phone.deviceId) {
    try {
      localStorage.setItem(PHONE_MICROPHONE_KEY, JSON.stringify({ deviceId: phone.deviceId, label: phone.label }));
    } catch (error) {
      console.warn("Could not remember the phone microphone", error);
    }
  }
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
