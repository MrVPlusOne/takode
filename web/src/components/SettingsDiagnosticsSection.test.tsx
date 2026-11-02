// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const updateSettings = vi.hoisted(() => vi.fn(async () => ({})));
const reportInputTrace = vi.hoisted(() => vi.fn(async () => ({ ok: true, eventCount: 0 })));
vi.mock("../api.js", () => ({ api: { updateSettings, reportInputTrace } }));

import { useStore } from "../store.js";
import { useInputTraceRecorder } from "../utils/input-trace.js";
import { SettingsDiagnosticsSection } from "./SettingsDiagnosticsSection.js";
import { ReportInputGlitchButton } from "./ReportInputGlitchButton.js";

/**
 * Settings > Diagnostics: the input trace is off by default, the toggle saves it to the server,
 * and the report actions appear (and record) only while it is on.
 */

function Harness() {
  useInputTraceRecorder();
  return (
    <>
      <SettingsDiagnosticsSection isRowHidden={() => false} />
      <ReportInputGlitchButton />
    </>
  );
}

afterEach(() => {
  cleanup();
  useStore.setState({ diagnostics: { inputTrace: false } });
  updateSettings.mockClear();
  reportInputTrace.mockClear();
});

describe("SettingsDiagnosticsSection", () => {
  it("starts off with no report actions, and turning the trace on saves it and offers reporting", async () => {
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Input trace" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: "Report input glitch" })).toBeNull();

    fireEvent.click(toggle);

    expect(updateSettings).toHaveBeenCalledWith({ diagnostics: { inputTrace: true } });
    // Both the Settings button and the sidebar button appear once the trace records.
    const buttons = await screen.findAllByRole("button", { name: "Report input glitch" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(reportInputTrace).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Sent 0 events at/)).toBeTruthy();
  });
});
