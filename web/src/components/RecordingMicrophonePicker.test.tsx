// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RecordingMicrophonePicker } from "./RecordingMicrophonePicker.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import type { VoiceMicrophoneSelection } from "../utils/voice-microphone.js";

function selection(): VoiceMicrophoneSelection {
  return {
    inputs: [
      { deviceId: "usb", label: "External microphone" },
      { deviceId: "built-in", label: "Built-in microphone" },
    ],
    refresh: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue("switched"),
  };
}

it("opens and closes on consecutive full taps, and dismisses on an outside press", async () => {
  // The trigger counts as inside even though its menu is portaled outside the composer.
  const control = selection();
  render(<RecordingMicrophonePicker label="Built-in microphone" selection={control} />);
  const trigger = screen.getByRole("button", { name: "Choose microphone: Built-in microphone" });
  await act(async () => fingerTap(trigger));
  expect(screen.getByRole("menu", { name: "Microphones" })).toBeInTheDocument();
  await act(async () => fingerTap(trigger));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await act(async () => fingerTap(trigger));
  fireEvent.pointerDown(document.body, { pointerType: "touch" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("requests a selected microphone directly in the pick and prevents a duplicate switch", async () => {
  const control = selection();
  let finish!: (value: "switched") => void;
  control.select = vi.fn(
    () =>
      new Promise<"switched">((resolve) => {
        finish = resolve;
      }),
  );
  render(<RecordingMicrophonePicker label="Built-in microphone" selection={control} />);
  await act(async () => fingerTap(screen.getByRole("button", { name: /Choose microphone/ })));
  fingerTap(screen.getByRole("menuitem", { name: "External microphone" }));
  // The media request must happen before any await, retaining the click's permission privilege.
  expect(control.select).toHaveBeenCalledExactlyOnceWith(control.inputs[0]);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Choose microphone/ })).toBeDisabled();
  await act(async () => finish("switched"));
  expect(screen.getByRole("button", { name: /Choose microphone/ })).toBeEnabled();
});

it("keeps the current mic label and explains the accepted next-recording fallback", async () => {
  const control = selection();
  control.select = vi.fn().mockResolvedValue("next-recording");
  render(<RecordingMicrophonePicker label="Built-in microphone" selection={control} />);
  await act(async () => fingerTap(screen.getByRole("button", { name: /Choose microphone/ })));
  await act(async () => fingerTap(screen.getByRole("menuitem", { name: "External microphone" })));
  expect(screen.getByRole("status")).toHaveTextContent("Saved for the next recording");
  expect(screen.getByRole("button", { name: /Choose microphone/ })).toHaveTextContent("Built-in microphone");
});

it("shows switch errors without pretending the selected device is recording", async () => {
  const control = selection();
  control.select = vi.fn().mockRejectedValue(new Error("The microphone was disconnected. Recording continues."));
  render(<RecordingMicrophonePicker label="Built-in microphone" selection={control} />);
  await act(async () => fingerTap(screen.getByRole("button", { name: /Choose microphone/ })));
  await act(async () => fingerTap(screen.getByRole("menuitem", { name: "External microphone" })));
  expect(screen.getByRole("status")).toHaveTextContent("Recording continues");
  expect(screen.getByRole("button", { name: /Choose microphone/ })).toHaveTextContent("Built-in microphone");
});

it("supports arrow-key navigation and consumes Escape before recording cancellation", async () => {
  render(<RecordingMicrophonePicker label="Built-in microphone" selection={selection()} />);
  await act(async () => fingerTap(screen.getByRole("button", { name: /Choose microphone/ })));
  expect(screen.getByRole("menuitem", { name: "External microphone" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Built-in microphone" })).toHaveFocus();
  const cancelRecording = vi.fn();
  window.addEventListener("keydown", cancelRecording);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  window.removeEventListener("keydown", cancelRecording);
  expect(cancelRecording).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Choose microphone/ })).toHaveFocus();
});

it("focuses choices discovered after opening without resetting ongoing keyboard navigation", async () => {
  // Permission-hidden devices can become available only after the menu refresh finishes.
  const control = selection();
  const view = render(<RecordingMicrophonePicker label="Built-in microphone" selection={{ ...control, inputs: [] }} />);
  const trigger = screen.getByRole("button", { name: /Choose microphone/ });
  trigger.focus();
  await act(async () => fingerTap(trigger));
  view.rerender(<RecordingMicrophonePicker label="Built-in microphone" selection={control} />);
  expect(screen.getByRole("menuitem", { name: "External microphone" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  view.rerender(
    <RecordingMicrophonePicker label="Built-in microphone" selection={{ ...control, inputs: [...control.inputs] }} />,
  );
  expect(screen.getByRole("menuitem", { name: "Built-in microphone" })).toHaveFocus();
});
