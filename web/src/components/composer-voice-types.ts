export interface VoiceEditProposal {
  originalText: string;
  editedText: string;
  instructionText: string;
}

export interface FailedTranscription {
  blob: Blob;
  mode: "dictation" | "edit" | "append";
  composerText: string;
  cursorContext: { before: string; after: string };
  transcriptionThreadKey?: string;
  transcriptionThreadTitle?: string;
}

export interface AlternateVoiceRerun {
  resultId: string;
  blob: Blob;
  sourceMode: "edit" | "append";
  composerText: string;
  cursorContext: { before: string; after: string };
  transcriptionThreadKey?: string;
  transcriptionThreadTitle?: string;
  status: "idle" | "running" | "error";
  message?: string;
}

export interface VoiceLevelSample {
  time: number;
  level: number;
}
