import { useState } from "react";
import { ComposerMetaToolbar } from "../ComposerMetaToolbar.js";
import { ComposerRecordingBar, ComposerUndoRedoButtons } from "../ComposerToolbarControls.js";
import { Card } from "./shared.js";
import { useSendKey } from "../../hooks/useSendKey.js";

const PLAYGROUND_LEVELS = Array.from({ length: 30 }, (_, i) => ({
  time: i,
  level: 0.2 + 0.6 * Math.abs(Math.sin(i / 2)),
}));

/** Streaming composer states: stop sits at the far left while mic and send keep their idle slots. */
export function PlaygroundStreamingComposerStates() {
  return (
    <>
      <Card label="Recording: cancel, running time and level take the left of the button row">
        <PlaygroundStreamingComposer initialDraft="Can you check why the keyboard closes?" recording />
      </Card>
      <div className="mt-4" />
      <Card label="Undo and redo after pause (touch screens only; open the Playground on a phone to see them)">
        <PlaygroundStreamingComposer initialDraft="My question" running={false} />
      </Card>
      <div className="mt-4" />
      <Card label="Running with an empty draft">
        <PlaygroundStreamingComposer initialDraft="" />
      </Card>
      <div className="mt-4" />
      <Card label="Running with a sendable follow-up">
        <PlaygroundStreamingComposer initialDraft="Can you refactor the auth module to use JWT?" />
      </Card>
      <div className="mt-4" />
      <Card label="Send pressed while blocked: the reason shows instead of nothing happening">
        <PlaygroundStreamingComposer
          initialDraft="See the attached screenshot"
          blockedNotice="1 image still uploading."
        />
      </Card>
    </>
  );
}

function PlaygroundStreamingComposer({
  initialDraft,
  blockedNotice,
  recording = false,
  running = !recording,
}: {
  initialDraft: string;
  blockedNotice?: string;
  recording?: boolean;
  running?: boolean;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [history, setHistory] = useState<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const changeDraft = (next: string) => {
    setHistory((h) => ({ past: [...h.past, draft], future: [] }));
    setDraft(next);
  };
  const canSend = !blockedNotice && draft.trim().length > 0;
  const sendKey = useSendKey();

  return (
    <div className={`border-t border-cc-border bg-cc-card px-4 py-3 ${blockedNotice ? "pt-14" : ""}`}>
      <div className="rounded-[14px] border border-cc-border bg-cc-input-bg">
        <textarea
          value={draft}
          onChange={(event) => changeDraft(event.target.value)}
          placeholder="Type to toggle Send; Stop, mic, and Send stay put"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-1 font-sans-ui text-sm text-cc-fg"
          style={{ minHeight: "36px" }}
        />
        <ComposerMetaToolbar
          imageUploadDisabled={false}
          imageUploadTitle="Upload image"
          pauseControl={null}
          editControls={
            <ComposerUndoRedoButtons
              canUndo={history.past.length > 0}
              canRedo={history.future.length > 0}
              onUndo={() => {
                const previous = history.past.at(-1);
                if (previous === undefined) return;
                setHistory({ past: history.past.slice(0, -1), future: [...history.future, draft] });
                setDraft(previous);
              }}
              onRedo={() => {
                const next = history.future.at(-1);
                if (next === undefined) return;
                setHistory({ past: [...history.past, draft], future: history.future.slice(0, -1) });
                setDraft(next);
              }}
            />
          }
          recordingBar={
            recording ? (
              <ComposerRecordingBar currentLevel={0.5} samples={PLAYGROUND_LEVELS} onCancel={() => {}} />
            ) : undefined
          }
          onOpenFilePicker={() => {}}
          warmMicrophone={() => {}}
          voiceSupported={true}
          toggleVoiceUnsupportedInfo={() => {}}
          handleMicClick={() => {}}
          voiceButtonDisabled={false}
          isPreparing={false}
          isRecording={recording}
          voiceButtonTitle="Voice input"
          canSend={canSend}
          sendBlocked={!!blockedNotice}
          sendNotice={blockedNotice ?? null}
          isRunning={running}
          handleInterrupt={() => {}}
          handleSend={() => {}}
          sendButtonTitle={blockedNotice ?? (canSend ? sendKey.hint : "Send message")}
          sendPressing={false}
        />
      </div>
    </div>
  );
}
