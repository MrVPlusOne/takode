// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreferredMicrophone,
  getVoiceCaptureDeviceId,
  listVoiceMicrophones,
  setPreferredMicrophone,
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
    setPreferredMicrophone(usb);
    expect(getPreferredMicrophone()).toMatchObject(usb);
    expect(getVoiceCaptureDeviceId()).toBe("usb");
    setPreferredMicrophone(null);
    expect(getPreferredMicrophone()).toBeNull();
    expect(getVoiceCaptureDeviceId()).toBe("default");
  });

  it("falls back while unplugged and selects the same device after reconnecting", async () => {
    setPreferredMicrophone(usb);
    enumerateDevices.mockResolvedValueOnce([builtIn]);
    await listVoiceMicrophones();
    expect(getVoiceCaptureDeviceId()).toBe("default");
    // Falling back must never overwrite the preference: reconnecting restores it automatically.
    expect(getPreferredMicrophone()?.deviceId).toBe("usb");
    await listVoiceMicrophones();
    expect(getVoiceCaptureDeviceId()).toBe("usb");
  });

  it("does not mistake a permission-hidden list for a disconnected preferred device", async () => {
    setPreferredMicrophone(usb);
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
