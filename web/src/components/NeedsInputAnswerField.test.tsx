// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { UseVoiceInputOptions } from "../hooks/useVoiceInput.js";
import type { SessionNotification } from "../types.js";
import type { NeedsInputQuestionView } from "../utils/notification-questions.js";
import { insertTextAtSelection } from "../utils/needs-input-voice-context.js";

const mockTranscribe = vi.hoisted(() =>
  vi.fn(async (_audio: Blob, _options?: unknown) => ({
    mode: "dictation" as const,
    text: "Takode",
    backend: "openai",
    enhanced: true,
  })),
);
const mockToggleRecording = vi.hoisted(() => vi.fn());
const voiceOptions = vi.hoisted(() => ({ current: null as UseVoiceInputOptions | null }));
const voiceState = vi.hoisted(() => ({
  current: {
    isRecording: false,
    volumeLevel: 0,
    volumeHistory: [] as Array<{ time: number; level: number }>,
  },
}));

vi.mock("../api.js", () => ({
  api: {
    transcribe: (audio: Blob, options?: unknown) => mockTranscribe(audio, options),
  },
}));

vi.mock("../hooks/useVoiceInput.js", async () => {
  const React = await import("react");
  return {
    useVoiceInput: (options: UseVoiceInputOptions) => {
      voiceOptions.current = options;
      const [error, setError] = React.useState<string | null>(null);
      const [isTranscribing, setIsTranscribing] = React.useState(false);
      const [transcriptionPhase, setTranscriptionPhase] = React.useState<string | null>(null);
      return {
        isRecording: voiceState.current.isRecording,
        isPreparing: false,
        isSupported: true,
        unsupportedReason: null,
        unsupportedMessage: null,
        isTranscribing,
        transcriptionPhase,
        error,
        volumeLevel: voiceState.current.volumeLevel,
        volumeHistory: voiceState.current.volumeHistory,
        setIsTranscribing,
        setTranscriptionPhase,
        setError,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        cancelRecording: vi.fn(),
        toggleRecording: mockToggleRecording,
        warmMicrophone: vi.fn(),
      };
    },
  };
});

import {
  autoResizeNeedsInputAnswerTextarea,
  NEEDS_INPUT_ANSWER_MAX_HEIGHT_PX,
  NeedsInputAnswerField,
} from "./NeedsInputAnswerField.js";

const notification: SessionNotification = {
  id: "n-voice",
  category: "needs-input",
  summary: "Approve deployment?",
  timestamp: Date.now(),
  messageId: "msg-voice",
  done: false,
};

const question: NeedsInputQuestionView = {
  key: "legacy",
  prompt: "Approve deployment?",
  suggestedAnswers: ["yes", "no"],
};

describe("NeedsInputAnswerField", () => {
  beforeEach(() => {
    mockTranscribe.mockReset();
    mockTranscribe.mockResolvedValue({
      mode: "dictation" as const,
      text: "Takode",
      backend: "openai",
      enhanced: true,
    });
    mockToggleRecording.mockClear();
    voiceOptions.current = null;
    voiceState.current.isRecording = false;
    voiceState.current.volumeLevel = 0;
    voiceState.current.volumeHistory = [];
  });

  it("auto-expands textarea height up to a capped internal scroll area", () => {
    const textarea = document.createElement("textarea");
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: NEEDS_INPUT_ANSWER_MAX_HEIGHT_PX + 80,
    });

    autoResizeNeedsInputAnswerTextarea(textarea);

    expect(textarea.style.height).toBe(`${NEEDS_INPUT_ANSWER_MAX_HEIGHT_PX}px`);
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("inserts transcribed voice text at the current selection and sends focused prompt context", async () => {
    const onChange = vi.fn();
    render(
      <NeedsInputAnswerField
        sessionId="s1"
        notification={notification}
        question={question}
        questionCount={1}
        value="hello world"
        onChange={onChange}
        placeholder="Your answer"
        sourceContext="The canary is green and rollback is ready."
        threadKey="q-777"
        threadTitle="q-777: Deploy service"
      />,
    );
    const textarea = screen.getByLabelText("Answer for Approve deployment?") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 11);

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));
    voiceOptions.current?.onAudioReady?.(new Blob(["voice"], { type: "audio/webm" }));

    expect(mockToggleRecording).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.objectContaining({
          mode: "dictation",
          sessionId: "s1",
          threadKey: "q-777",
          threadTitle: "q-777: Deploy service",
          focusedContext: expect.stringContaining("Needs-input prompt: Approve deployment?"),
        }),
      ),
    );
    const options = mockTranscribe.mock.calls[0]?.[1] as unknown as { focusedContext: string };
    expect(options.focusedContext).toContain("Notification source context:");
    expect(options.focusedContext).toContain("The canary is green and rollback is ready.");
    expect(options.focusedContext).toContain("Suggested answers: yes, no");
    expect(onChange).toHaveBeenCalledWith("hello Takode");
  });

  it("uses simple dictation insertion semantics without edit or append mode", () => {
    expect(insertTextAtSelection("ship now", "please ", { value: "ship now", start: 0, end: 0 })).toBe(
      "please ship now",
    );
    expect(insertTextAtSelection("ship later", "now", { value: "ship later", start: 5, end: 10 })).toBe("ship now");
    expect(insertTextAtSelection("changed", " later", { value: "stale", start: 5, end: 5 })).toBe("changed later");
  });

  it("shows composer-style recording feedback and an active stop button while recording", () => {
    voiceState.current.isRecording = true;
    voiceState.current.volumeLevel = 0.72;
    voiceState.current.volumeHistory = [
      { time: 1, level: 0.18 },
      { time: 2, level: 0.42 },
      { time: 3, level: 0.84 },
    ];

    render(
      <NeedsInputAnswerField
        sessionId="s1"
        notification={notification}
        question={question}
        questionCount={1}
        value="ship now"
        onChange={vi.fn()}
        placeholder="Your answer"
      />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop voice answer" });
    expect(stopButton).toHaveAttribute("aria-pressed", "true");
    expect(stopButton).toHaveAttribute("data-recording", "true");
    expect(stopButton.className).toContain("bg-cc-primary");
    expect(screen.getByTestId("needs-input-recording-status")).toHaveTextContent("Recording");
    expect(screen.getByTestId("voice-level-waveform")).toBeInTheDocument();
    expect(screen.getAllByTestId("voice-level-waveform-bar")).toHaveLength(40);
    expect(screen.queryByText("Recording...")).not.toBeInTheDocument();
  });

  it("preserves the start-time selection baseline when stopping recording after the answer changes", async () => {
    function ControlledAnswerField() {
      const [value, setValue] = useState("ship now");
      return (
        <NeedsInputAnswerField
          sessionId="s1"
          notification={notification}
          question={question}
          questionCount={1}
          value={value}
          onChange={setValue}
          placeholder="Your answer"
          threadKey="main"
          threadTitle="Main Thread"
        />
      );
    }

    render(<ControlledAnswerField />);
    const textarea = screen.getByLabelText("Answer for Approve deployment?") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));
    expect(mockToggleRecording).toHaveBeenCalledTimes(1);

    voiceState.current.isRecording = true;
    fireEvent.change(textarea, { target: { value: "manual edit" } });

    fireEvent.click(screen.getByRole("button", { name: "Stop voice answer" }));
    expect(mockToggleRecording).toHaveBeenCalledTimes(2);
    voiceOptions.current?.onAudioReady?.(new Blob(["voice"], { type: "audio/webm" }));

    await waitFor(() => expect(textarea).toHaveValue("manual editTakode"));
  });

  it("keeps failed voice audio retryable and retries with the original needs-input context", async () => {
    const voiceBlob = new Blob(["voice"], { type: "audio/webm" });
    const onChange = vi.fn();
    mockTranscribe.mockRejectedValueOnce(new Error("Transcription timed out")).mockResolvedValueOnce({
      mode: "dictation" as const,
      text: "approved",
      backend: "openai",
      enhanced: true,
    });

    render(
      <NeedsInputAnswerField
        sessionId="s1"
        notification={notification}
        question={question}
        questionCount={1}
        value="ship later"
        onChange={onChange}
        placeholder="Your answer"
        sourceContext="The canary is green."
        threadKey="q-777"
        threadTitle="q-777: Deploy service"
      />,
    );
    const textarea = screen.getByLabelText("Answer for Approve deployment?") as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 10);

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));
    voiceOptions.current?.onAudioReady?.(voiceBlob);

    await waitFor(() => expect(screen.getByTestId("needs-input-transcription-failure")).toBeInTheDocument());
    expect(screen.getByText("Transcription timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("ship approved"));
    expect(mockTranscribe).toHaveBeenCalledTimes(2);
    expect(mockTranscribe.mock.calls[1]?.[0]).toBe(voiceBlob);
    expect(mockTranscribe.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        mode: "dictation",
        sessionId: "s1",
        threadKey: "q-777",
        threadTitle: "q-777: Deploy service",
        focusedContext: expect.stringContaining("Needs-input prompt: Approve deployment?"),
      }),
    );
    expect(screen.queryByTestId("needs-input-transcription-failure")).not.toBeInTheDocument();
  });

  it("keeps retry available after a retry failure until dismissed", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("First failure")).mockRejectedValueOnce(new Error("Still failing"));

    render(
      <NeedsInputAnswerField
        sessionId="s1"
        notification={notification}
        question={question}
        questionCount={1}
        value="ship now"
        onChange={vi.fn()}
        placeholder="Your answer"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));
    voiceOptions.current?.onAudioReady?.(new Blob(["voice"], { type: "audio/webm" }));

    await waitFor(() => expect(screen.getByText("First failure")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Still failing")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss transcription error"));
    expect(screen.queryByTestId("needs-input-transcription-failure")).not.toBeInTheDocument();
  });

  it("clears a retryable failure when starting a new recording", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("Stale failure"));

    render(
      <NeedsInputAnswerField
        sessionId="s1"
        notification={notification}
        question={question}
        questionCount={1}
        value="ship now"
        onChange={vi.fn()}
        placeholder="Your answer"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));
    voiceOptions.current?.onAudioReady?.(new Blob(["voice"], { type: "audio/webm" }));

    await waitFor(() => expect(screen.getByText("Stale failure")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Voice answer" }));

    expect(screen.queryByTestId("needs-input-transcription-failure")).not.toBeInTheDocument();
    expect(mockToggleRecording).toHaveBeenCalledTimes(2);
  });
});
