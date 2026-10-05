import type { BackendType } from "../server/session-types.js";

export type BackendFamily = "claude" | "codex";

/** A concrete session backend, or the family name chosen when creating a session. */
export type BackendSelection = BackendType | BackendFamily;

export const DEFAULT_MODEL_BY_BACKEND_FAMILY: Record<BackendFamily, string> = {
  claude: "",
  codex: "gpt-5.6-sol",
};

export function getBackendFamily(backend: BackendSelection): BackendFamily {
  return backend === "codex" ? "codex" : "claude";
}

export function getDefaultModelForBackendFamily(family: BackendFamily): string {
  return DEFAULT_MODEL_BY_BACKEND_FAMILY[family];
}

export function getDefaultModelForBackend(backend: BackendSelection): string {
  return getDefaultModelForBackendFamily(getBackendFamily(backend));
}
