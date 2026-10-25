import { VoiceInputIcon } from "./VoiceInputIcon.js";
import type { ReactNode } from "react";

function PaperPlaneIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M2 2.5L14 8 2 13.5 2 9.5 9 8 2 6.5Z" />
    </svg>
  );
}

export function ComposerMetaToolbar({
  imageUploadDisabled,
  imageUploadTitle,
  pauseControl,
  editControls,
  recordingBar,
  onOpenFilePicker,
  warmMicrophone,
  voiceSupported,
  toggleVoiceUnsupportedInfo,
  handleMicClick,
  voiceButtonDisabled,
  isPreparing,
  isRecording,
  voiceButtonTitle,
  canSend,
  sendBlocked,
  sendNotice,
  isRunning,
  handleInterrupt,
  handleSend,
  sendButtonTitle,
  sendPressing,
}: {
  imageUploadDisabled: boolean;
  imageUploadTitle: string;
  pauseControl: ReactNode;
  /** Undo and redo, after pause. */
  editControls?: ReactNode;
  /** While recording, replaces the left side of the row. */
  recordingBar?: ReactNode;
  onOpenFilePicker: () => void;
  warmMicrophone: () => void;
  voiceSupported: boolean;
  toggleVoiceUnsupportedInfo: (expandComposerOnReveal?: boolean) => void;
  handleMicClick: () => void;
  voiceButtonDisabled: boolean;
  isPreparing: boolean;
  isRecording: boolean;
  voiceButtonTitle: string;
  canSend: boolean;
  /** There is something to send, but sending is blocked; a press shows why instead of doing nothing. */
  sendBlocked: boolean;
  /** Why the last press did not send, shown until the draft or its blocker changes. */
  sendNotice: string | null;
  isRunning: boolean;
  handleInterrupt: () => void;
  handleSend: () => void;
  sendButtonTitle: string;
  sendPressing: boolean;
}) {
  return (
    <div data-testid="composer-footer-toolbar" className="flex items-center gap-x-2 px-2.5 pb-2.5 pt-1">
      {/* Model, effort and access live in the session title (SessionSettingsMenu); only pause stays here. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {recordingBar ?? (
          <>
            <div className="shrink-0">{pauseControl}</div>
            {editControls}
          </>
        )}
      </div>

      {/* Mic and send keep fixed positions in every state: users re-click the mic's usual spot to stop
          recording, so a control appearing to their right could turn that click into an interrupt.
          Stop therefore only ever appears at the far left of the group. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-1">
        {isRunning && (
          <button
            onClick={handleInterrupt}
            aria-label="Stop generation"
            className="flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full transition-colors bg-cc-error/10 hover:bg-cc-error/20 text-cc-error cursor-pointer"
            title="Stop generation"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 sm:w-3.5 sm:h-3.5">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
          </button>
        )}

        <button
          onClick={onOpenFilePicker}
          disabled={imageUploadDisabled}
          className={`flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg transition-colors ${
            !imageUploadDisabled
              ? "text-cc-muted hover:text-cc-fg hover:bg-cc-hover cursor-pointer"
              : "text-cc-muted opacity-30 cursor-not-allowed"
          }`}
          title={imageUploadTitle}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-5 h-5 sm:w-4 sm:h-4"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
            <path d="M2 11l3-3 2 2 3-4 4 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          // Warm up only on mouse hover. A touch's pointerenter is not a user gesture, and on
          // iPhone a microphone request without one can bring the permission prompt back.
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") warmMicrophone();
          }}
          onClick={!voiceSupported ? () => toggleVoiceUnsupportedInfo(false) : handleMicClick}
          disabled={voiceButtonDisabled}
          aria-label="Voice input"
          aria-disabled={!voiceSupported || voiceButtonDisabled}
          className={`flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg transition-colors ${
            !voiceSupported || voiceButtonDisabled
              ? "text-cc-muted opacity-30 cursor-not-allowed"
              : isPreparing
                ? "text-cc-warning bg-cc-warning/10 cursor-wait"
                : isRecording
                  ? "text-cc-primary bg-cc-primary/10 hover:bg-cc-primary/20 cursor-pointer"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover cursor-pointer"
          }`}
          title={voiceButtonTitle}
        >
          <VoiceInputIcon active={isRecording || isPreparing} />
        </button>

        <div className="relative group">
          <button
            onClick={handleSend}
            disabled={!canSend && !sendBlocked}
            aria-disabled={!canSend || undefined}
            aria-label="Send message"
            data-sent={sendPressing || undefined}
            className={`flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full transition-colors ${
              canSend || sendPressing
                ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                : "bg-cc-hover text-cc-muted cursor-not-allowed"
            } cc-squish`}
            title={sendButtonTitle}
          >
            <span className="cc-send-icon">
              <PaperPlaneIcon className="w-5 h-5 sm:w-4 sm:h-4" />
            </span>
          </button>
          {(sendNotice || sendBlocked) && (
            <div
              role={sendNotice ? "alert" : undefined}
              className={`pointer-events-none absolute bottom-full right-0 mb-2 ${sendNotice ? "block" : "hidden group-hover:block"}`}
            >
              <div className="w-max max-w-[16rem] rounded-lg border border-cc-border bg-cc-card px-3 py-1.5 text-[11px] text-cc-fg shadow-lg">
                {sendNotice ?? sendButtonTitle}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
