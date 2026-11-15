// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerMetaToolbar } from "./ComposerMetaToolbar.js";

// The model, effort and access controls moved to the session title; their tests live in
// SessionSettingsMenu.test.tsx. This toolbar keeps pause, image, mic, Stop and Send.
function ToolbarHarness({
  warmMicrophone = () => {},
  sendQueued = false,
  sendNotice = null,
}: {
  warmMicrophone?: () => void;
  sendQueued?: boolean;
  sendNotice?: string | null;
}) {
  return (
    <div className="w-[320px]">
      <ComposerMetaToolbar
        imageUploadDisabled={false}
        imageUploadTitle="Upload image"
        voicebackControl={null}
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
        sendBlocked={false}
        sendNotice={sendNotice}
        sendQueued={sendQueued}
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

describe("ComposerMetaToolbar queued send", () => {
  it("circles Send with a turning ring only while a send waits", () => {
    // Jiayi: after pressing Send while images upload, only a tooltip showed that the press was
    // taken. A ring now turns around the button until the message goes out; it is gone otherwise, so
    // nothing keeps animating afterwards (the idle-animation rule).
    const view = render(<ToolbarHarness sendQueued />);
    const sendWrapper = screen.getByRole("button", { name: "Send message" }).parentElement!;
    const ring = sendWrapper.querySelector("svg.animate-spin-slow");
    expect(ring).not.toBeNull();
    // It must not take the button's clicks, and it holds still for reduced motion.
    expect(ring!.getAttribute("class")).toContain("pointer-events-none");
    expect(ring!.getAttribute("class")).toContain("motion-reduce:animate-none");

    view.rerender(<ToolbarHarness />);
    expect(sendWrapper.querySelector("svg.animate-spin-slow")).toBeNull();
  });

  it("raises the waiting notice above the message box's text", () => {
    // On a phone the notice overlaps the draft, and without its own stacking order the draft's text
    // painted over it (seen with Ink & Paper in dark), so it read as see-through.
    render(<ToolbarHarness sendQueued sendNotice="Sends when 2 images finish uploading." />);
    expect(screen.getByRole("alert").className.split(" ")).toContain("z-20");
  });
});
