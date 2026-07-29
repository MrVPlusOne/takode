export const TRANSCRIPTION_PREVIEW_MAX_CHARACTERS = 160;
export const TRANSCRIPTION_PREVIEW_READ_MAX_BYTES = 4 * 1024;

function containsExplicitAbsolutePath(value: string): boolean {
  return (
    /[A-Za-z]:[\\/]/.test(value) ||
    /(?:^|[\s"'`([{=,:;])(?:\\\\|\/\/)[^\s"'`\])}]+/.test(value) ||
    /(?:^|[\s"'`([{=,:;])\/[^\s"'`\])}]+/.test(value) ||
    /file:\/\//i.test(value)
  );
}

export function normalizeTranscriptionPreview(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized) ||
    normalized.includes("�") ||
    containsExplicitAbsolutePath(normalized)
  ) {
    return undefined;
  }

  const characters = Array.from(normalized);
  if (characters.length <= TRANSCRIPTION_PREVIEW_MAX_CHARACTERS) return normalized;
  return `${characters.slice(0, TRANSCRIPTION_PREVIEW_MAX_CHARACTERS - 1).join("")}…`;
}

export function buildTranscriptionPreview(
  enhancedText: string | null | undefined,
  rawTranscript: string | null | undefined,
): string | undefined {
  return normalizeTranscriptionPreview(enhancedText) ?? normalizeTranscriptionPreview(rawTranscript);
}
