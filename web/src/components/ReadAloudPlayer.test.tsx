// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadAloudPlayback, ReadAloudPreferences, ReadAloudState } from "../read-aloud-player.js";

const player = vi.hoisted(() => ({
  state: null as ReadAloudState | null,
  playback: { currentTime: 12, duration: 65, paused: false } as ReadAloudPlayback,
  preferences: { voice: "marin", playbackRate: 1 } as ReadAloudPreferences,
  seek: vi.fn(),
  skip: vi.fn(),
  toggle: vi.fn(),
  stop: vi.fn(),
  setRate: vi.fn(),
  setVoice: vi.fn(),
}));
vi.mock("../read-aloud-player.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../read-aloud-player.js")>()),
  useCurrentReadAloud: () => player.state,
  useReadAloudPlayback: () => player.playback,
  useReadAloudPreferences: () => player.preferences,
  seekReadAloud: player.seek,
  skipReadAloud: player.skip,
  toggleReadAloudPause: player.toggle,
  stopReadAloud: player.stop,
  setReadAloudPlaybackRate: player.setRate,
  setReadAloudVoice: player.setVoice,
}));

import { ReadAloudPlayer } from "./ReadAloudPlayer.js";

describe("ReadAloudPlayer", () => {
  beforeEach(() => {
    player.state = { messageId: "m1", sessionId: "s1", status: "ready" };
    vi.clearAllMocks();
  });

  it("shows only under the message being read, and not for a failed read", () => {
    const { rerender } = render(<ReadAloudPlayer messageId="other" />);
    expect(screen.queryByTestId("read-aloud-player")).toBeNull();
    rerender(<ReadAloudPlayer messageId="m1" />);
    expect(screen.getByTestId("read-aloud-player")).toBeVisible();
    player.state = { messageId: "m1", sessionId: "s1", status: "error", error: "boom" };
    rerender(<ReadAloudPlayer messageId="m1" />);
    expect(screen.queryByTestId("read-aloud-player")).toBeNull();
  });

  it("drives seek, skip, pause, speed, voice and close", () => {
    render(<ReadAloudPlayer messageId="m1" />);
    expect(screen.getByText("0:12")).toBeVisible();
    expect(screen.getByText("1:05")).toBeVisible();

    fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "30" } });
    expect(player.seek).toHaveBeenCalledWith(30);
    fireEvent.click(screen.getByRole("button", { name: "Back 5 seconds" }));
    expect(player.skip).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole("button", { name: "Forward 5 seconds" }));
    expect(player.skip).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(player.toggle).toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), { target: { value: "1.5" } });
    expect(player.setRate).toHaveBeenCalledWith(1.5);
    // The voice menu offers the four voices Jiayi chose.
    const voice = screen.getByRole("combobox", { name: "Voice" });
    expect([...voice.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Marin",
      "Cedar",
      "Coral",
      "Ash",
    ]);
    fireEvent.change(voice, { target: { value: "ash" } });
    expect(player.setVoice).toHaveBeenCalledWith("ash");
    fireEvent.click(screen.getByRole("button", { name: "Stop reading aloud" }));
    expect(player.stop).toHaveBeenCalled();
  });

  it("disables the controls while the audio is prepared", () => {
    player.state = { messageId: "m1", sessionId: "s1", status: "preparing" };
    render(<ReadAloudPlayer messageId="m1" />);
    expect(screen.getByText("Preparing audio…")).toBeVisible();
    expect(screen.getByRole("slider", { name: "Position" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back 5 seconds" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preparing audio" })).toHaveAttribute("aria-busy", "true");
  });
});
