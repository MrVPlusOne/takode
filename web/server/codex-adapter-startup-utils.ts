import { toSafeText } from "./codex-adapter-utils.js";

export function hasSkillChangeCauseMetadata(payload: Record<string, unknown>): boolean {
  return ["cause", "source", "path", "paths", "root", "roots"].some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key),
  );
}

export function isTakodeDelegateStartupReady(params: Record<string, unknown>): boolean {
  return toSafeText(params.name).trim() === "takode_delegate" && toSafeText(params.status).trim() === "ready";
}
