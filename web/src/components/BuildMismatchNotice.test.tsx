// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  announceBackendConnectionOpen,
  BACKEND_CONNECTION_OPEN_EVENT,
  getBuildCompatibilitySnapshot,
  observeBackendBuildId,
  resetBuildCompatibilityForTest,
} from "../build-compatibility.js";
import { ActiveBuildMismatchNotice, BuildMismatchNotice } from "./BuildMismatchNotice.js";

beforeEach(() => {
  resetBuildCompatibilityForTest();
});

describe("frontend/backend build compatibility", () => {
  it("stays quiet for a matching identity", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observeBackendBuildId("development");
    });

    expect(getBuildCompatibilitySnapshot()).toMatchObject({
      frontendBuildId: "development",
      backendBuildId: "development",
      status: "compatible",
    });
    expect(screen.queryByTestId("build-mismatch-notice")).toBeNull();
  });

  it("fails closed when a successful server response has no valid build identity", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observeBackendBuildId("   ");
    });

    expect(getBuildCompatibilitySnapshot()).toMatchObject({ backendBuildId: null, status: "mismatch" });
    expect(screen.getByRole("alert", { name: "Frontend update required" })).toBeInTheDocument();
  });

  it("shows a persistent accessible notice after a confirmed mismatch", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observeBackendBuildId("another-build");
    });

    const notice = screen.getByRole("alert", { name: "Frontend update required" });
    expect(notice).toHaveTextContent("outdated or incompatible");
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();

    act(() => {
      // A late response from the former server must not hide a confirmed mismatch.
      observeBackendBuildId("development");
    });
    expect(screen.getByTestId("build-mismatch-notice")).toBeInTheDocument();
  });

  it("exposes a keyboard-native Reload action without forcing navigation", () => {
    const onReload = vi.fn();
    render(<BuildMismatchNotice placement="inline" onReload={onReload} />);

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(onReload).toHaveBeenCalledOnce();
  });

  it("announces WebSocket opens so the app can re-check the backend build", () => {
    const listener = vi.fn();
    window.addEventListener(BACKEND_CONNECTION_OPEN_EVENT, listener);

    announceBackendConnectionOpen();

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(BACKEND_CONNECTION_OPEN_EVENT, listener);
  });
});
