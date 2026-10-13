// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsMicrophone } from "./SettingsMicrophone.js";
import { getMicrophoneOrder, rememberMicrophone } from "../utils/voice-microphone.js";

const usb = { kind: "audioinput", deviceId: "usb", label: "External microphone" };
let getUserMedia: ReturnType<typeof vi.fn>;
let enumerateDevices: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  getUserMedia = vi.fn();
  enumerateDevices = vi.fn().mockResolvedValue([usb]);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: Object.assign(new EventTarget(), { getUserMedia, enumerateDevices }),
  });
});
afterEach(() => vi.restoreAllMocks());

it("shows the saved order without a chooser or permission request, restores on remount and can reset", async () => {
  // The former Settings picker is now a read-only view: the recording row owns all picks.
  rememberMicrophone(usb);
  const view = render(<SettingsMicrophone />);
  await screen.findByRole("list", { name: "Remembered microphone order" });
  expect(screen.getByText(usb.label)).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
  view.unmount();
  render(<SettingsMicrophone />);
  expect(screen.getByText(usb.label)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset to system mic" }));
  expect(getMicrophoneOrder()).toEqual([]);
  expect(screen.getByText("Following the system microphone.")).toBeInTheDocument();
});

it("does not open the microphone to reveal permission-hidden names", async () => {
  // Discovery never needs permission in this read-only view; names come from saved explicit picks.
  rememberMicrophone(usb);
  enumerateDevices.mockResolvedValue([{ kind: "audioinput", label: "", deviceId: "" }]);
  render(<SettingsMicrophone />);
  expect(await screen.findByText(usb.label)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Find microphones" })).not.toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("retains an unplugged selection and updates when the device returns", async () => {
  rememberMicrophone(usb);
  enumerateDevices.mockResolvedValue([]);
  render(<SettingsMicrophone />);
  await screen.findByText("(not currently listed)");
  enumerateDevices.mockResolvedValue([usb]);
  await act(async () => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
  expect(screen.queryByText("(not currently listed)")).not.toBeInTheDocument();
  expect(getMicrophoneOrder()[0].deviceId).toBe("usb");
});

it("reports storage denial on reset without losing the remembered order", async () => {
  rememberMicrophone(usb);
  render(<SettingsMicrophone />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset to system mic" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reset microphone order");
  expect(getMicrophoneOrder()[0].deviceId).toBe("usb");
});

it("reports enumeration failure without opening or losing a microphone", async () => {
  rememberMicrophone(usb);
  enumerateDevices.mockRejectedValue(new Error("Device list failed"));
  render(<SettingsMicrophone />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not check connected microphones");
  expect(screen.getByText(usb.label)).toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("updates the read-only list when a recording-row pick changes the order", async () => {
  render(<SettingsMicrophone />);
  await act(async () => {
    rememberMicrophone(usb);
    rememberMicrophone({ deviceId: "built-in", label: "Built-in microphone" });
  });
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Built-in microphone (not currently listed)",
    "External microphone",
  ]);
});
