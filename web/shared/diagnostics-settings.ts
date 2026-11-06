/**
 * Development diagnostics the user can turn on in Settings. Each one records something only
 * developers need, so every diagnostic is off unless the user turns it on, and Settings says
 * what it records. Add a new diagnostic as its own field here, defaulting to false.
 */
export interface DiagnosticsSettings {
  /**
   * Keep a rolling record of the last hour of input activity in the browser (key presses,
   * pastes, focus changes; lengths only, never text), saved incrementally to the server.
   * "Report input glitch" also saves a manual snapshot in the server log.
   */
  inputTrace: boolean;
}

export const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = { inputTrace: false };

/** Reads saved or submitted diagnostics settings; anything missing or malformed is off. */
export function parseDiagnosticsSettings(raw: unknown): DiagnosticsSettings {
  const candidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { inputTrace: candidate.inputTrace === true };
}
