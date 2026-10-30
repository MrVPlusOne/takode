import { useAnnotationSourceNavigation } from "./use-annotation-source-navigation.js";
import { useEffect } from "react";
import { useStore } from "../store.js";
import { AnnotationAttachments } from "./AnnotationAttachments.js";
import { AnnotationEditor } from "./AnnotationEditor.js";
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

export function ComposerAnnotations({
  sessionId,
  draftKey = sessionId,
  threadKey,
  threadTitle,
  disabled = false,
}: {
  sessionId: string;
  /** Where the draft is kept (see Composer). */
  draftKey?: string;
  threadKey: string;
  threadTitle?: string;
  disabled?: boolean;
}) {
  const openSource = useAnnotationSourceNavigation(sessionId, threadKey, draftKey);
  const draft = useStore((state) => state.composerDrafts.get(draftKey));
  const editor = useStore((state) => state.annotationEditor);
  const annotations = draft?.annotations ?? [];
  const activeEditor = editsHere(editor, sessionId, draftKey, threadKey) ? editor : null;
  useEffect(
    () => () => {
      const state = useStore.getState();
      if (editsHere(state.annotationEditor, sessionId, draftKey, threadKey)) state.setAnnotationEditor(null);
    },
    [sessionId, draftKey, threadKey],
  );
  const remove = (id: string) => {
    const state = useStore.getState();
    const current = state.composerDrafts.get(draftKey);
    if (current)
      state.setComposerDraft(draftKey, {
        ...current,
        annotations: current.annotations?.filter((entry) => entry.id !== id),
      });
    if (state.annotationEditor?.annotation.id === id) state.setAnnotationEditor(null);
  };
  return (
    <>
      <AnnotationAttachments
        sessionId={sessionId}
        annotations={annotations}
        disabled={disabled}
        onEdit={(annotation) => void openSource(annotation)}
        onRemove={disabled ? undefined : remove}
      />
      {activeEditor?.navigateToSource && (
        <p role="status" className="text-xs text-cc-muted">
          Opening comment at its source…
        </p>
      )}
      {activeEditor && !activeEditor.navigateToSource && !disabled && (
        <AnnotationEditor
          key={`${sessionId}:${threadKey}:${activeEditor.annotation.id}`}
          sessionId={sessionId}
          threadKey={threadKey}
          threadTitle={threadTitle}
          annotation={activeEditor.annotation}
          position={activeEditor.position}
          sourceUnavailable={activeEditor.sourceUnavailable}
          context={{
            activeId: activeEditor.annotation.id,
            activeNumber: annotations.some((entry) => entry.id === activeEditor.annotation.id)
              ? annotations.findIndex((entry) => entry.id === activeEditor.annotation.id) + 1
              : annotations.length + 1,
            selectedText: activeEditor.annotation.selectedText,
            mainComposerText: draft?.text ?? "",
            otherAnnotations: annotations
              .map((entry, index) => ({ ...entry, number: index + 1 }))
              .filter((entry) => entry.id !== activeEditor.annotation.id),
          }}
          onCancel={() => useStore.getState().setAnnotationEditor(null)}
          onRemove={
            annotations.some((entry) => entry.id === activeEditor.annotation.id)
              ? () => remove(activeEditor.annotation.id)
              : undefined
          }
          onSave={(comment) => {
            const state = useStore.getState();
            const current = state.composerDrafts.get(draftKey) ?? { text: "", images: [] };
            const saved = { ...activeEditor.annotation, comment };
            const previous = current.annotations ?? [];
            state.setComposerDraft(draftKey, {
              ...current,
              annotations: previous.some((entry) => entry.id === saved.id)
                ? previous.map((entry) => (entry.id === saved.id ? saved : entry))
                : [...previous, saved],
            });
            state.setAnnotationEditor(null);
          }}
        />
      )}
    </>
  );
}
