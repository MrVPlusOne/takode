// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { playReviewSound, previewNotificationSoundSet } from "../utils/notification-sound.js";
import { NotificationSoundSetSetting } from "./SettingsNotificationSound.js";

vi.mock("../utils/notification-sound.js", () => ({
  previewNotificationSoundSet: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

describe("NotificationSoundSetSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(previewNotificationSoundSet).mockClear();
    useStore.setState({ notificationSoundSet: "classic" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the chosen set on this device and plays it", () => {
    render(<NotificationSoundSetSetting />);
    fireEvent.change(screen.getByLabelText("Alert Sound"), { target: { value: "singing-bowl" } });

    expect(useStore.getState().notificationSoundSet).toBe("singing-bowl");
    // Stored unscoped: the choice belongs to the device, whichever server it talks to.
    expect(localStorage.getItem("cc-notification-sound-set")).toBe("singing-bowl");
    expect(previewNotificationSoundSet).toHaveBeenCalledWith("singing-bowl");
  });

  it("replays the current set from Preview", () => {
    useStore.setState({ notificationSoundSet: "lounge-piano" });
    render(<NotificationSoundSetSetting />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(previewNotificationSoundSet).toHaveBeenCalledWith("lounge-piano");
  });

  it("shows Custom's two sounds and uploads a file for one of them", async () => {
    // Server state: only the needs-input sound is uploaded until the PUT below adds review.
    let review: object | null = null;
    const needsInput = { name: "knock.wav", mimeType: "audio/wav", size: 8, updatedAt: 1 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        review = { name: "chime.mp3", mimeType: "audio/mpeg", size: 3, updatedAt: 2 };
        return Response.json(review);
      }
      return Response.json({ "needs-input": needsInput, review });
    });
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ notificationSoundSet: "custom" });
    render(<NotificationSoundSetSetting />);

    expect(await screen.findByText("knock.wav")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();

    const file = new File([new Uint8Array([1, 2, 3])], "chime.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText("Upload New result sound"), { target: { files: [file] } });

    expect(await screen.findByText("chime.mp3")).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/api/notification-sounds/review");
    expect(put?.[1]?.headers).toEqual({ "Content-Type": "audio/mpeg", "X-File-Name": "chime.mp3" });
    // The new sound plays once uploaded, so the user hears what they picked.
    await waitFor(() => expect(playReviewSound).toHaveBeenCalledWith("custom"));
  });
});
