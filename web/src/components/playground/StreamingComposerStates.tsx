import { useRef, useState } from "react";
import { ComposerMetaToolbar } from "../ComposerMetaToolbar.js";
import { CLAUDE_MODELS, getClaudePermissionMenuOptions } from "../../utils/backends.js";
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
    </>
  );
}

function PlaygroundStreamingComposer({ initialDraft }: { initialDraft: string }) {
  const [draft, setDraft] = useState(initialDraft);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const permissionDropdownRef = useRef<HTMLDivElement | null>(null);
  const canSend = draft.trim().length > 0;
  const sendKey = useSendKey();

  return (
    <div className="border-t border-cc-border bg-cc-card px-4 py-3">
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
          sessionId={`playground-streaming-composer-${initialDraft ? "draft" : "empty"}`}
          sessionView={{ model: "claude-sonnet-4-5-20250929", gitAhead: 0, gitBehind: 0 }}
          isCodex={false}
          isConnected={true}
          canEditLaunchSettings={true}
          imageUploadDisabled={false}
          imageUploadTitle="Upload image"
          showModelDropdown={false}
          setShowModelDropdown={() => {}}
          modelDropdownRef={modelDropdownRef}
          claudeModelOptions={CLAUDE_MODELS.filter((model) => model.value)}
          codexModelOptions={[]}
          onSelectModel={() => {}}
          claudeReasoningEffort=""
          onSelectClaudeReasoning={() => {}}
          codexReasoningEffort=""
          codexEffectiveReasoningEffort={null}
          codexEffectiveReasoningEffortReported={false}
          onSelectCodexReasoning={() => {}}
          codexServiceTier={null}
          codexFastServiceTier={null}
          onSelectCodexServiceTier={() => {}}
          onResetCodexSettings={async () => {}}
          permissionOptions={getClaudePermissionMenuOptions("acceptEdits")}
          permissionMode="acceptEdits"
          showPermissionDropdown={false}
          setShowPermissionDropdown={() => {}}
          permissionDropdownRef={permissionDropdownRef}
          pendingPermissionMode={null}
          onRequestPermissionMode={() => {}}
          onCancelPermissionMode={() => {}}
          onConfirmPermissionMode={() => {}}
          collapseAllButton={null}
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
          isRunning={true}
          handleInterrupt={() => {}}
          handleSend={() => {}}
          sendButtonTitle={canSend ? sendKey.hint : "Send message"}
          sendPressing={false}
        />
      </div>
    </div>
  );
}
