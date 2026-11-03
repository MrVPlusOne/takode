import type { AnnotationEditorState } from "../types.js";

/**
 * Whether a composer shows the comment being edited: one for its own draft (a comment made in a side
 * chat goes to the side chat's composer, one made in the main feed to the main one), in its thread
 * when the editor names one.
 */
export function editsHere(
  editor: AnnotationEditorState | null,
  sessionId: string,
  draftKey: string,
  threadKey: string,
): editor is AnnotationEditorState {
  return (
    !!editor &&
    editor.sessionId === sessionId &&
    (editor.draftKey ?? sessionId) === draftKey &&
    (!editor.threadKey || editor.threadKey === threadKey)
  );
}
