// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { ComposerAnnotations } from "./ComposerAnnotations.js";
import { AnnotationAttachments } from "./AnnotationAttachments.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { sendComposerDraft } from "./composer-message-send.js";

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  send: vi.fn(),
  audioReady: null as null | ((blob: Blob) => void),
}));
vi.mock("../api.js", () => ({ api: { transcribe: mocks.transcribe } }));
vi.mock("../ws.js", () => ({ sendToSession: mocks.send }));
vi.mock("../hooks/useVoiceInput.js", async () => {
  const React = await import("react");
  return {
    useVoiceInput: (options: { onAudioReady: (blob: Blob) => void }) => {
      mocks.audioReady = options.onAudioReady;
      const [isTranscribing, setIsTranscribing] = React.useState(false);
      const [error, setError] = React.useState<string | null>(null);
      const [transcriptionPhase, setTranscriptionPhase] = React.useState<string | null>(null);
      return {
        isRecording: false,
        isPreparing: false,
        isSupported: true,
        isTranscribing,
        setIsTranscribing,
        error,
        setError,
        transcriptionPhase,
        setTranscriptionPhase,
        toggleRecording: vi.fn(),
        cancelRecording: vi.fn(),
        volumeHistory: [],
        volumeLevel: 0,
      };
    },
  };
});

const first = { id: "first", selectedText: "Selected text", comment: "First comment", sourceMessageId: "source" };
const second = { id: "second", selectedText: "Another selection", comment: "" };

beforeEach(() => {
  mocks.transcribe.mockReset().mockResolvedValue({ text: "New spoken comment" });
  mocks.send.mockReset().mockReturnValue(true);
  useStore.setState({
    annotationEditor: null,
    composerDrafts: new Map([["session", { text: "Main draft", images: [], annotations: [first] }]]),
    replyContexts: new Map(),
    pendingUserUploads: new Map(),
    pendingUserUploadRestorations: new Map(),
  });
});
afterEach(cleanup);

function openNewComment() {
  useStore.getState().setAnnotationEditor({ sessionId: "session", annotation: second });
  return render(<ComposerAnnotations sessionId="session" threadKey="main" />);
}

describe("composer annotation attachments", () => {
  it("saves, edits and removes pairs without expanding the main text draft", () => {
    // All mutations are browser-local drafts; no message is admitted until the existing send path runs.
    openNewComment();
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Second comment" } });
    fireEvent.click(screen.getByText("Save"));
    expect(useStore.getState().composerDrafts.get("session")).toMatchObject({
      text: "Main draft",
      annotations: [first, { ...second, comment: "Second comment" }],
    });
    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Revised comment" } });
    fireEvent.click(screen.getByText("Save"));
    expect(useStore.getState().composerDrafts.get("session")?.annotations?.[1].comment).toBe("Revised comment");
    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.click(screen.getByLabelText("Delete comment"));
    expect(useStore.getState().composerDrafts.get("session")?.annotations).toEqual([first]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("saves the comment with the active send key, matching the composer", () => {
    // Default scheme: Enter saves and Shift+Enter keeps editing (newline); the alternate scheme
    // makes Enter a newline and saves on Cmd/Ctrl+Enter.
    const saved = () => useStore.getState().composerDrafts.get("session")?.annotations?.[1]?.comment;
    openNewComment();
    const textarea = screen.getByLabelText("Comment");
    fireEvent.change(textarea, { target: { value: "Keyboard comment" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(saved()).toBeUndefined();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(saved()).toBe("Keyboard comment");
    cleanup();

    useStore.setState({ sendKeyScheme: "mod-enter" });
    try {
      useStore.getState().setAnnotationEditor({ sessionId: "session", annotation: { ...second, id: "third" } });
      render(<ComposerAnnotations sessionId="session" threadKey="main" />);
      const next = screen.getByLabelText("Comment");
      fireEvent.change(next, { target: { value: "Mod comment" } });
      fireEvent.keyDown(next, { key: "Enter" });
      expect(useStore.getState().composerDrafts.get("session")?.annotations).toHaveLength(2);
      fireEvent.keyDown(next, { key: "Enter", metaKey: true });
      expect(useStore.getState().composerDrafts.get("session")?.annotations?.[2]?.comment).toBe("Mod comment");
      expect(screen.queryByLabelText("Comment")).toBeNull();
    } finally {
      useStore.setState({ sendKeyScheme: "enter" });
    }
  });

  it("saves a non-empty comment when clicking outside, and only Cancel or Escape discard", () => {
    // Accidental outside clicks used to discard the draft. A press and release on the backdrop now behaves like
    // Save for new and existing comments; with empty text it just closes and keeps the saved comment unchanged.
    const annotations = () => useStore.getState().composerDrafts.get("session")?.annotations;
    const clickOutside = () => {
      const backdrop = screen.getByRole("dialog").parentElement!;
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
    };
    openNewComment();
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Kept comment" } });
    clickOutside();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(annotations()).toEqual([first, { ...second, comment: "Kept comment" }]);

    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Revised outside" } });
    clickOutside();
    expect(annotations()?.[1].comment).toBe("Revised outside");

    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "  " } });
    clickOutside();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(annotations()?.[1].comment).toBe("Revised outside");

    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Discarded by Escape" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("Comment 2"));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Discarded by Cancel" } });
    fireEvent.click(screen.getByText("Cancel"));
    expect(annotations()?.[1].comment).toBe("Revised outside");
  });

  it("stays open when the outside click ends a selection drag or voice work is unsettled", async () => {
    // A selection that starts in the textarea and is released over the backdrop produces a click on the backdrop;
    // only a press that also started outside counts. Pending transcription and an undecided voice edit stay open
    // so the outside click neither saves stale text nor drops the proposal.
    const clickOutside = (pressTarget?: Element) => {
      const backdrop = screen.getByRole("dialog").parentElement!;
      fireEvent.pointerDown(pressTarget ?? backdrop);
      fireEvent.click(backdrop);
    };
    let complete!: (result: { text: string }) => void;
    mocks.transcribe.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    useStore.getState().setAnnotationEditor({ sessionId: "session", annotation: first });
    render(<ComposerAnnotations sessionId="session" threadKey="main" />);
    clickOutside(screen.getByLabelText("Comment"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Comment voice mode"), { target: { value: "edit" } });
    fireEvent.click(screen.getByLabelText("Voice comment"));
    act(() => mocks.audioReady?.(new Blob(["audio"])));
    clickOutside();
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => complete({ text: "Proposed text" }));
    expect(screen.getByText("Proposed text")).toBeTruthy();
    clickOutside();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByText("Accept edit"));
    clickOutside();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useStore.getState().composerDrafts.get("session")?.annotations?.[0].comment).toBe("Proposed text");
  });

  it("keeps contextual dictation confined to the current unsaved comment", async () => {
    openNewComment();
    fireEvent.click(screen.getByLabelText("Voice comment"));
    await act(async () => mocks.audioReady?.(new Blob(["audio"])));
    expect(mocks.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({
        mode: "dictation",
        composerText: "",
        sessionId: "session",
        threadKey: "main",
        annotationContext: {
          activeId: "second",
          activeNumber: 2,
          selectedText: second.selectedText,
          mainComposerText: "Main draft",
          otherAnnotations: [{ ...first, number: 1 }],
        },
      }),
    );
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("New spoken comment");
    expect(useStore.getState().composerDrafts.get("session")?.annotations).toEqual([first]);
  });

  it("previews a voice edit and never replaces other comments or the main message", async () => {
    useStore.getState().setAnnotationEditor({ sessionId: "session", annotation: first });
    render(<ComposerAnnotations sessionId="session" threadKey="main" />);
    fireEvent.change(screen.getByLabelText("Comment voice mode"), { target: { value: "edit" } });
    fireEvent.click(screen.getByLabelText("Voice comment"));
    await act(async () => mocks.audioReady?.(new Blob(["audio"])));
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe(first.comment);
    expect(mocks.transcribe.mock.calls[0][1]).toMatchObject({
      mode: "edit",
      composerText: first.comment,
      annotationContext: { otherAnnotations: [] },
    });
    fireEvent.click(screen.getByText("Accept edit"));
    fireEvent.click(screen.getByText("Save"));
    expect(useStore.getState().composerDrafts.get("session")).toMatchObject({
      text: "Main draft",
      annotations: [{ ...first, comment: "New spoken comment" }],
    });
  });

  it("does not apply a late voice response after changing the destination", async () => {
    let complete!: (result: { text: string }) => void;
    mocks.transcribe.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = openNewComment();
    fireEvent.click(screen.getByLabelText("Voice comment"));
    act(() => mocks.audioReady?.(new Blob(["audio"])));
    view.rerender(<ComposerAnnotations sessionId="session" threadKey="another-thread" />);
    await act(async () => complete({ text: "Late text" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useStore.getState().composerDrafts.get("session")?.annotations).toEqual([first]);
  });

  it("retains structured annotations in failed pending sends and sends an empty main message", () => {
    mocks.send.mockReturnValue(false);
    const draft = { text: "", images: [], annotations: [first] };
    expect(sendComposerDraft("session", draft, { threadKey: "main" }, false)).toBe("retained");
    expect(mocks.send).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({ type: "user_message", content: "", annotations: [first] }),
    );
    expect(useStore.getState().pendingUserUploads.get("session")?.[0]).toMatchObject({
      content: "",
      annotations: [first],
      stage: "failed",
    });
  });

  it("rehydrates attachment previews from server metadata rather than parsing user text", () => {
    // Producer-shaped history is the authority, including an annotation-only message.
    const [message] = normalizeHistoryMessageToChatMessages(
      { type: "user_message", content: "", annotations: [first], timestamp: 1, id: "stored" },
      0,
    );
    expect(message.metadata?.annotations).toEqual([first]);
    render(<AnnotationAttachments annotations={message.metadata?.annotations ?? []} />);
    fireEvent.click(screen.getByLabelText("Comment 1"));
    expect(screen.getByText(first.selectedText)).toBeTruthy();
    expect(screen.getByText(first.comment)).toBeTruthy();
  });
});

// Cancelling during recording must not start a new request when the recorder later releases its Blob.
it("ignores audio that arrives after its editor unmounts", () => {
  const view = openNewComment();
  fireEvent.click(screen.getByLabelText("Voice comment"));
  const lateAudio = mocks.audioReady;
  view.unmount();
  act(() => lateAudio?.(new Blob(["late audio"])));
  expect(mocks.transcribe).not.toHaveBeenCalled();
});

it("rehydrates structured attachments from a pending-question answer receipt", () => {
  const annotationMessage = { content: "Discuss first", annotations: [first] };
  const [message] = normalizeHistoryMessageToChatMessages(
    {
      type: "permission_approved",
      id: "answer",
      tool_name: "AskUserQuestion",
      tool_use_id: "question",
      summary: "Answered",
      timestamp: 1,
      annotationMessage,
    },
    0,
  );
  expect(message.metadata?.annotationMessage).toEqual(annotationMessage);
});
