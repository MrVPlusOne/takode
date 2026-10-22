import type {
  CustomNotificationSoundInfo,
  CustomNotificationSoundList,
  CustomNotificationSoundSlot,
} from "../../shared/custom-notification-sounds.js";

/** Where a browser fetches an uploaded custom sound; the server answers 404 when there is none. */
export function customNotificationSoundUrl(slot: CustomNotificationSoundSlot): string {
  return `/api/notification-sounds/${slot}/audio`;
}

export async function fetchCustomNotificationSounds(): Promise<CustomNotificationSoundList> {
  return readJson(await fetch("/api/notification-sounds"));
}

/** Uploads `file` as the custom sound for `slot`, replacing any earlier one. */
export async function uploadCustomNotificationSound(
  slot: CustomNotificationSoundSlot,
  file: File,
): Promise<CustomNotificationSoundInfo> {
  const res = await fetch(`/api/notification-sounds/${slot}`, {
    method: "PUT",
    headers: { "Content-Type": audioMimeType(file), "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
  return readJson(res);
}

export async function removeCustomNotificationSound(slot: CustomNotificationSoundSlot): Promise<void> {
  await readJson(await fetch(`/api/notification-sounds/${slot}`, { method: "DELETE" }));
}

const AUDIO_TYPES_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

/** Some pickers give audio files no type, so fall back to the extension. */
function audioMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : res.statusText);
  return body as T;
}
