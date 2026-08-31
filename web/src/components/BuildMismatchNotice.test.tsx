// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  announceBackendConnectionOpen,
  BACKEND_CONNECTION_OPEN_EVENT,
  beginBuildIdentityObservation,
  classifyBuildCompatibility,
  getBuildCompatibilitySnapshot,
  observeServerBuildIdentity,
  resetBuildCompatibilityForTest,
  type BuildCompatibilitySnapshot,
} from "../build-compatibility.js";
import { ActiveBuildMismatchNotice, BuildMismatchNotice } from "./BuildMismatchNotice.js";

beforeEach(() => {
  resetBuildCompatibilityForTest();
});

function compatibility(overrides: Partial<BuildCompatibilitySnapshot> = {}): BuildCompatibilitySnapshot {
  return {
    frontendBuildId: "development",
    servedFrontendBuildId: "development",
    backendBuildId: "development",
    status: "compatible",
    reason: null,
    ...overrides,
  };
}

function observe(backendBuildId: unknown, servedFrontendBuildId: unknown): BuildCompatibilitySnapshot {
  const observationSequence = beginBuildIdentityObservation();
  return observeServerBuildIdentity(backendBuildId, servedFrontendBuildId, observationSequence);
}

describe("frontend/backend build compatibility", () => {
  it("classifies loaded, served, and backend identities without treating readiness as compatibility", () => {
    expect(classifyBuildCompatibility("build-a", "build-a", "build-a")).toMatchObject({
      status: "compatible",
      reason: null,
    });
    expect(classifyBuildCompatibility("build-a", "build-b", "build-b")).toMatchObject({
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });
    expect(classifyBuildCompatibility("build-b", null, "build-b")).toMatchObject({
      status: "restart-required",
      reason: "backend-identity-unavailable",
    });
    expect(classifyBuildCompatibility("build-a", "build-b", "build-a")).toMatchObject({
      status: "restart-required",
      reason: "server-pair-mismatch",
    });
    expect(classifyBuildCompatibility("build-a", "build-a", null)).toMatchObject({
      status: "restart-required",
      reason: "served-frontend-identity-unavailable",
    });
  });

  it("stays quiet for a matching loaded, served, and backend identity", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observe("development", "development");
    });

    expect(getBuildCompatibilitySnapshot()).toMatchObject({
      frontendBuildId: "development",
      backendBuildId: "development",
      servedFrontendBuildId: "development",
      status: "compatible",
      reason: null,
    });
    expect(screen.queryByTestId("build-mismatch-notice")).toBeNull();
  });

  it("diagnoses a legacy supervisor with no backend identity instead of offering ineffective Reload", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observe(null, "development");
    });

    expect(getBuildCompatibilitySnapshot()).toMatchObject({
      backendBuildId: null,
      servedFrontendBuildId: "development",
      status: "restart-required",
      reason: "backend-identity-unavailable",
    });
    const notice = screen.getByRole("alert", { name: "Takode restart required" });
    expect(notice).toHaveTextContent("backend has no build identity");
    expect(notice).toHaveTextContent("Fully stop and start Takode");
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("offers Reload after a full supervisor restart produces a coherent new server pair", () => {
    render(<ActiveBuildMismatchNotice />);
    act(() => {
      observe(null, "development");
    });
    expect(screen.getByRole("alert", { name: "Takode restart required" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();

    act(() => {
      observe("build-next", "build-next");
    });
    expect(screen.getByRole("alert", { name: "Frontend update required" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  });

  it("ignores an older matching response after a newer probe requires Reload", () => {
    render(<ActiveBuildMismatchNotice />);
    const olderMatchingProbe = beginBuildIdentityObservation();
    const newerReloadProbe = beginBuildIdentityObservation();

    act(() => {
      observeServerBuildIdentity("another-build", "another-build", newerReloadProbe);
    });

    const notice = screen.getByRole("alert", { name: "Frontend update required" });
    expect(notice).toHaveTextContent("compatible frontend is ready");
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();

    act(() => {
      observeServerBuildIdentity("development", "development", olderMatchingProbe);
    });
    expect(screen.getByRole("alert", { name: "Frontend update required" })).toBeInTheDocument();
  });

  it("replaces Reload with a full-restart diagnosis when a newer probe finds a broken server pair", () => {
    render(<ActiveBuildMismatchNotice />);

    act(() => {
      observe("build-next", "build-next");
    });
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();

    act(() => {
      observe("build-backend", "build-served");
    });

    expect(screen.getByRole("alert", { name: "Takode restart required" })).toHaveTextContent(
      "different build identities",
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("shows observed build details and no Reload action for a server pair mismatch", () => {
    render(
      <BuildMismatchNotice
        placement="inline"
        compatibility={compatibility({
          frontendBuildId: "build-loaded",
          servedFrontendBuildId: "build-served",
          backendBuildId: "build-backend",
          status: "restart-required",
          reason: "server-pair-mismatch",
        })}
      />,
    );

    expect(screen.getByRole("alert", { name: "Takode restart required" })).toHaveTextContent(
      "different build identities",
    );
    fireEvent.click(screen.getByText("Build details"));
    expect(screen.getByText("build-loaded")).toBeInTheDocument();
    expect(screen.getByText("build-served")).toBeInTheDocument();
    expect(screen.getByText("build-backend")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("a new matching document clears a prior reloadable mismatch", () => {
    render(<ActiveBuildMismatchNotice />);
    act(() => {
      observe("build-next", "build-next");
    });
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();

    act(() => {
      // A page navigation creates a new JavaScript document and therefore a fresh compatibility snapshot.
      resetBuildCompatibilityForTest();
      observe("development", "development");
    });
    expect(screen.queryByTestId("build-mismatch-notice")).toBeNull();
  });

  it("exposes a keyboard-native Reload action without forcing navigation", () => {
    const onReload = vi.fn();
    render(
      <BuildMismatchNotice
        placement="inline"
        onReload={onReload}
        compatibility={compatibility({
          servedFrontendBuildId: "build-next",
          backendBuildId: "build-next",
          status: "reload-required",
          reason: "loaded-frontend-outdated",
        })}
      />,
    );

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
