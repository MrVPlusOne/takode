// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerMetaToolbar } from "./ComposerMetaToolbar.js";

// The model, effort and access controls moved to the session title; their tests live in
// SessionSettingsMenu.test.tsx. This toolbar keeps pause, image, mic, Stop and Send.
function ToolbarHarness({ warmMicrophone = () => {} }: { warmMicrophone?: () => void }) {
  return (
    <div className="w-[320px]">
      <ComposerMetaToolbar
        imageUploadDisabled={false}
        imageUploadTitle="Upload image"
        pauseControl={null}
        onOpenFilePicker={() => {}}
        warmMicrophone={warmMicrophone}
        voiceSupported={true}
        toggleVoiceUnsupportedInfo={() => {}}
        handleMicClick={() => {}}
        voiceButtonDisabled={false}
        isPreparing={false}
        isRecording={false}
        voiceButtonTitle="Voice input"
        canSend={true}
        isRunning={false}
        handleInterrupt={() => {}}
        handleSend={() => {}}
        sendButtonTitle="Send"
        sendPressing={false}
      />
    </div>
  );
}

describe("ComposerMetaToolbar microphone warm-up", () => {
  it("warms the microphone on mouse hover but not when a touch enters the button", () => {
    // A touch's pointerenter is not a user gesture. On iPhone a microphone request made
    // outside a gesture re-prompts for permission after a minute of idle microphone, so the
    // tap's own click must make the request instead.
    const warmMicrophone = vi.fn();
    render(<ToolbarHarness warmMicrophone={warmMicrophone} />);
    const micButton = screen.getByRole("button", { name: "Voice input" });

    fireEvent.pointerEnter(micButton, { pointerType: "touch" });
    expect(warmMicrophone).not.toHaveBeenCalled();

    fireEvent.pointerEnter(micButton, { pointerType: "mouse" });
    expect(warmMicrophone).toHaveBeenCalledTimes(1);
  });
});
