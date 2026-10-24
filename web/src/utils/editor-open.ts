import type { EditorKind } from "../api.js";
import type { MachineSettings } from "../remote-hosts.js";
import { buildSshEditorUri, openFileWithEditorPreference, type VsCodeOpenFileTarget } from "./vscode-bridge.js";

/** The machine holding a file, by its name and settings. */
export interface FileMachine {
  name: string;
  settings: MachineSettings;
}

/** Whether a file can be opened in the user's editor, and how. */
export type EditorOpen =
  /** No editor is chosen in Settings. */
  | { kind: "none" }
  | { kind: "unavailable"; label: string; reason: string }
  | { kind: "available"; label: string; open: (target: VsCodeOpenFileTarget) => Promise<void> };

/**
 * How the editor chosen in Settings can open a file on `machine`. Editor links open on the user's
 * own computer, so a file there opens directly ("local"), a file on another machine opens through
 * Remote-SSH by the SSH host name set for it, and a machine with neither set up can't be opened.
 * The Takode VS Code extension (`vscode-remote`) opens files itself, so it needs no setup.
 */
export function editorOpenFor(editor: EditorKind, machine: FileMachine | null): EditorOpen {
  if (editor === "none") return { kind: "none" };
  const label = editor === "cursor" ? "Open in Cursor" : "Open in VS Code";
  const editorName = editor === "cursor" ? "Cursor" : "VS Code";
  if (editor === "vscode-remote") {
    return {
      kind: "available",
      label,
      open: async (target) => void (await openFileWithEditorPreference(target, editor)),
    };
  }
  if (!machine) return { kind: "unavailable", label, reason: "Takode doesn't know which machine holds this file." };
  const { editorAccess, sshHost } = machine.settings;
  if (editorAccess === "local") {
    return {
      kind: "available",
      label,
      open: async (target) => void (await openFileWithEditorPreference(target, editor)),
    };
  }
  if (editorAccess === "ssh" && sshHost) {
    return {
      kind: "available",
      label,
      open: async (target) =>
        void window.open(buildSshEditorUri(target, editor, sshHost), "_blank", "noopener,noreferrer"),
    };
  }
  return {
    kind: "unavailable",
    label,
    reason: `${editorName} can't reach ${machine.name} yet. In Settings > Hosts, choose how your computer opens ${machine.name}'s files: "It's my computer" or over SSH.`,
  };
}
