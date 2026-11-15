/** Video and audio files Takode's file viewer plays, by extension, with the type browsers need to play them. */
const MEDIA_TYPES: Record<string, { kind: "video" | "audio"; mimeType: string }> = {
  mp4: { kind: "video", mimeType: "video/mp4" },
  m4v: { kind: "video", mimeType: "video/mp4" },
  mov: { kind: "video", mimeType: "video/quicktime" },
  webm: { kind: "video", mimeType: "video/webm" },
  ogv: { kind: "video", mimeType: "video/ogg" },
  mp3: { kind: "audio", mimeType: "audio/mpeg" },
  m4a: { kind: "audio", mimeType: "audio/mp4" },
  aac: { kind: "audio", mimeType: "audio/aac" },
  wav: { kind: "audio", mimeType: "audio/wav" },
  ogg: { kind: "audio", mimeType: "audio/ogg" },
  oga: { kind: "audio", mimeType: "audio/ogg" },
  opus: { kind: "audio", mimeType: "audio/ogg" },
  flac: { kind: "audio", mimeType: "audio/flac" },
};

/** Whether a linked file is a video or audio file the viewer plays, and its media type; null otherwise. */
export function fileLinkMediaType(path: string): { kind: "video" | "audio"; mimeType: string } | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (extension && MEDIA_TYPES[extension]) || null;
}
