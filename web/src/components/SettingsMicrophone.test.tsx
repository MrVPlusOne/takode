// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SettingsMicrophone } from "./SettingsMicrophone.js";
import { getPreferredMicrophone, setPreferredMicrophone } from "../utils/voice-microphone.js";

const usb = { kind: "audioinput", deviceId: "usb", label: "External microphone" };
let getUserMedia: ReturnType<typeof vi.fn>;
let enumerateDevices: ReturnType<typeof vi.fn>;
let stop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  stop = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  enumerateDevices = vi.fn().mockResolvedValue([usb]);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: Object.assign(new EventTarget(), { getUserMedia, enumerateDevices }),
  });
});

it("lists without prompting, saves immediately, restores on remount and can return to system-follow", async () => {
  const view = render(<SettingsMicrophone />);
  await screen.findByRole("option", { name: usb.label });
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "usb" } });
  expect(getPreferredMicrophone()).toEqual({ deviceId: "usb", label: usb.label });
  view.unmount();
  render(<SettingsMicrophone />);
  await screen.findByRole("option", { name: usb.label });
  expect(screen.getByRole("combobox")).toHaveValue("usb");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(getPreferredMicrophone()).toBeNull();
});

it("reveals names from a permission click and always releases the temporary stream", async () => {
  enumerateDevices.mockResolvedValueOnce([{ kind: "audioinput", label: "", deviceId: "" }]);
  render(<SettingsMicrophone />);
  await waitFor(() => expect(enumerateDevices).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Find microphones" }));
  // getUserMedia must precede any await, including device enumeration, to preserve the click.
  expect(getUserMedia).toHaveBeenCalledOnce();
  await screen.findByRole("option", { name: usb.label });
  expect(stop).toHaveBeenCalledOnce();
});

it("retains an unplugged selection and updates when the device returns", async () => {
  setPreferredMicrophone(usb);
  enumerateDevices.mockResolvedValue([]);
  render(<SettingsMicrophone />);
  await screen.findByRole("option", { name: "External microphone (not currently listed)" });
  enumerateDevices.mockResolvedValue([usb]);
  act(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
  await screen.findByRole("option", { name: usb.label });
  expect(screen.getByRole("combobox")).toHaveValue("usb");
});

it("shows denial without retrying or changing the saved preference", async () => {
  getUserMedia.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  render(<SettingsMicrophone />);
  fireEvent.click(screen.getByRole("button", { name: "Find microphones" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access denied");
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Find microphones" })).toBeEnabled();
});

it("releases the permission stream even if subsequent enumeration fails", async () => {
  render(<SettingsMicrophone />);
  await screen.findByRole("option", { name: usb.label });
  enumerateDevices.mockRejectedValue(new Error("Device list failed"));
  fireEvent.click(screen.getByRole("button", { name: "Find microphones" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not list microphones");
  expect(stop).toHaveBeenCalledOnce();
});
