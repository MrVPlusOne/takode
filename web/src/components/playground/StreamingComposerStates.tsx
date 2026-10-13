import { useState } from "react";
import { ComposerMetaToolbar } from "../ComposerMetaToolbar.js";
import { Card } from "./shared.js";
import { useSendKey } from "../../hooks/useSendKey.js";

/** Streaming composer states: stop sits at the far left while mic and send keep their idle slots. */
export function PlaygroundStreamingComposerStates() {
  return (
    <>
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
}: {
  initialDraft: string;
  blockedNotice?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const canSend = !blockedNotice && draft.trim().length > 0;
  const sendKey = useSendKey();

  return (
    <div className={`border-t border-cc-border bg-cc-card px-4 py-3 ${blockedNotice ? "pt-14" : ""}`}>
      <div className="rounded-[14px] border border-cc-border bg-cc-input-bg">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type to toggle Send; Stop, mic, and Send stay put"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-1 font-sans-ui text-sm text-cc-fg"
          style={{ minHeight: "36px" }}
        />
        <ComposerMetaToolbar
          imageUploadDisabled={false}
          imageUploadTitle="Upload image"
          pauseControl={null}
          onOpenFilePicker={() => {}}
          warmMicrophone={() => {}}
          voiceSupported={true}
          toggleVoiceUnsupportedInfo={() => {}}
          handleMicClick={() => {}}
          voiceButtonDisabled={false}
          isPreparing={false}
          isRecording={false}
          voiceButtonTitle="Voice input"
          canSend={canSend}
          sendBlocked={!!blockedNotice}
          sendNotice={blockedNotice ?? null}
          isRunning={true}
          handleInterrupt={() => {}}
          handleSend={() => {}}
          sendButtonTitle={blockedNotice ?? (canSend ? sendKey.hint : "Send message")}
          sendPressing={false}
        />
      </div>
    </div>
  );
}
