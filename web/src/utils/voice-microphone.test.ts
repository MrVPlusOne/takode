// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMicrophoneOrder,
  getVoiceCaptureDeviceId,
  listVoiceMicrophones,
  rememberMicrophone,
  resetMicrophoneOrder,
  watchVoiceMicrophones,
} from "./voice-microphone.js";

const usb = { kind: "audioinput", deviceId: "usb", label: "External microphone" };
const builtIn = { kind: "audioinput", deviceId: "built-in", label: "Built-in" };
let enumerateDevices: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  enumerateDevices = vi.fn().mockResolvedValue([builtIn, usb]);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: Object.assign(new EventTarget(), { enumerateDevices }),
  });
});

describe("browser microphone preference", () => {
  it("defaults to system-follow and retains a saved preference across reads", () => {
    expect(getVoiceCaptureDeviceId()).toBe("default");
    rememberMicrophone(usb);
    expect(getMicrophoneOrder()).toEqual([{ deviceId: usb.deviceId, label: usb.label }]);
    expect(getVoiceCaptureDeviceId()).toBe("usb");
    resetMicrophoneOrder();
    expect(getMicrophoneOrder()).toEqual([]);
    expect(getVoiceCaptureDeviceId()).toBe("default");
  });

  it("falls back while unplugged and selects the same device after reconnecting", async () => {
    rememberMicrophone(usb);
    enumerateDevices.mockResolvedValueOnce([builtIn]);
    await listVoiceMicrophones();
    expect(getVoiceCaptureDeviceId()).toBe("default");
    // Falling back must never overwrite the preference: reconnecting restores it automatically.
    expect(getMicrophoneOrder()[0]?.deviceId).toBe("usb");
    await listVoiceMicrophones();
    expect(getVoiceCaptureDeviceId()).toBe("usb");
  });

  it("does not mistake a permission-hidden list for a disconnected preferred device", async () => {
    rememberMicrophone(usb);
    enumerateDevices.mockResolvedValue([{ kind: "audioinput", deviceId: "", label: "" }]);
    expect(await listVoiceMicrophones()).toEqual([]);
    expect(getVoiceCaptureDeviceId()).toBe("usb");
  });

  it("omits output devices and default aliases from the physical microphone choices", async () => {
    enumerateDevices.mockResolvedValue([
      usb,
      builtIn,
      { ...usb, deviceId: "default" },
      { ...usb, deviceId: "communications" },
      { ...usb, kind: "audiooutput" },
    ]);
    expect(await listVoiceMicrophones()).toEqual([usb, builtIn]);
  });

  it("refreshes after device changes and focus, and detaches on unmount", async () => {
    const update = vi.fn();
    const stop = watchVoiceMicrophones(update, vi.fn());
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    stop();
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
  });
});

it("moves explicit picks to the front without duplicating or forgetting disconnected microphones", async () => {
  rememberMicrophone(usb);
  rememberMicrophone(builtIn);
  rememberMicrophone(usb);
  expect(getMicrophoneOrder().map((entry) => entry.deviceId)).toEqual(["usb", "built-in"]);
  enumerateDevices.mockResolvedValue([builtIn]);
  await listVoiceMicrophones();
  expect(getVoiceCaptureDeviceId()).toBe("built-in");
  expect(getMicrophoneOrder().map((entry) => entry.deviceId)).toEqual(["usb", "built-in"]);
});

it("preserves the previous single preference until a pick or reset migrates it", () => {
  // Existing users keep their chosen mic, but the old Settings chooser has no continuing writer.
  localStorage.setItem("cc-preferred-microphone", JSON.stringify(usb));
  expect(getVoiceCaptureDeviceId()).toBe("usb");
  rememberMicrophone(builtIn);
  expect(getMicrophoneOrder().map((entry) => entry.deviceId)).toEqual(["built-in", "usb"]);
  expect(localStorage.getItem("cc-preferred-microphone")).toBeNull();
  resetMicrophoneOrder();
  expect(getVoiceCaptureDeviceId()).toBe("default");
});
