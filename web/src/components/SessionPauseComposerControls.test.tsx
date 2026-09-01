// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PausedInputChip, PauseOtherSourcesButton } from "./SessionPauseComposerControls.js";
import type { CodexResultErrorAutoPauseState, SessionPauseState } from "../types.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePauseState(): SessionPauseState {
  return {
    pausedAt: 1_000,
    queuedMessages: [
      {
        id: "held-1",
        queuedAt: new Date("2026-05-08T10:15:00Z").getTime(),
        source: "programmatic",
        message: {
          type: "user_message",
          content: "Timer reminder while paused",
          agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" },
        },
      },
      {
        id: "held-2",
        queuedAt: new Date("2026-05-08T10:16:00Z").getTime(),
        source: "browser",
        message: { type: "user_message", content: "Browser-origin external send" },
      },
    ],
  };
}

function makeAutoPauseState(
  family: CodexResultErrorAutoPauseState["family"] = "copilot_auth_refresh_exhausted",
): CodexResultErrorAutoPauseState {
  return {
    family,
    fingerprint: "PRIVATE FINGERPRINT MUST NOT RENDER",
    streak: family === "copilot_auth_refresh_exhausted" ? 1 : 3,
    threshold: family === "copilot_auth_refresh_exhausted" ? 1 : 3,
    pausedAt: new Date("2026-05-08T10:15:00Z").getTime(),
    lastError: "PRIVATE RAW PROVIDER ERROR MUST NOT RENDER",
    lastErrorAt: new Date("2026-05-08T11:45:00Z").getTime(),
    lastSourceKind: "manual",
    totalMatchingErrors: 4,
    heldInputs: [
      {
        id: "held-herd",
        queuedAt: new Date("2026-05-08T10:16:00Z").getTime(),
        lastQueuedAt: new Date("2026-05-08T10:17:00Z").getTime(),
        source: "programmatic",
        count: 2,
        message: {
          type: "user_message",
          content: "PRIVATE HELD PAYLOAD MUST NOT RENDER",
          agentSource: { sessionId: "herd-events", sessionLabel: "PRIVATE TRUSTED ROUTE LABEL MUST NOT RENDER" },
        },
      },
    ],
  };
}

describe("PauseOtherSourcesButton", () => {
  it("uses explanatory tooltip copy and toggles pause from the composer area", async () => {
    const onToggle = vi.fn();
    render(
      <PauseOtherSourcesButton
        isPaused={false}
        heldCount={0}
        busy={false}
        directComposerMessagesSend={true}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByTestId("composer-pause-sources-button");
    expect(button.getAttribute("title")).toBe(
      "Pause other input sources. Direct composer messages still send; CLI, timer, herd, and programmatic work is held.",
    );

    await userEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("uses theme-aware contrast tokens while paused", () => {
    render(
      <PauseOtherSourcesButton
        isPaused={true}
        heldCount={2}
        busy={false}
        directComposerMessagesSend={true}
        onToggle={() => {}}
      />,
    );

    const button = screen.getByTestId("composer-pause-sources-button");
    expect(button.className).toContain("border-cc-attention/75");
    expect(button.className).toContain("bg-cc-attention-bg");
    expect(button.className).toContain("text-cc-attention-strong");
    expect(button.className).not.toContain("text-amber-300");
  });

  it("does not imply direct composer sends work while the session is disconnected", () => {
    render(
      <PauseOtherSourcesButton
        isPaused={false}
        heldCount={0}
        busy={false}
        directComposerMessagesSend={false}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId("composer-pause-sources-button").getAttribute("title")).toBe(
      "Pause other input sources. Direct composer messages still need the session to resume.",
    );
  });
});

describe("PausedInputChip", () => {
  it("shows paused mode and expands to inspect held messages", async () => {
    render(<PausedInputChip pause={makePauseState()} heldCount={2} directComposerMessagesSend={true} />);

    expect(screen.getByTestId("composer-paused-chip").textContent).toContain("Other sources paused");
    expect(screen.getByText("2 held inputs")).toBeTruthy();
    expect(screen.queryByTestId("composer-auto-pause-release")).toBeNull();
    expect(screen.queryByTestId("composer-held-input-list")).toBeNull();

    await userEvent.click(screen.getByTestId("composer-paused-chip"));

    const list = screen.getByTestId("composer-held-input-list");
    expect(list.textContent).toContain("Timer t1");
    expect(list.textContent).toContain("Timer reminder while paused");
    expect(list.textContent).toContain("Browser-origin external send");
  });

  it("stays visible with an empty held list while paused", async () => {
    render(
      <PausedInputChip
        pause={{ pausedAt: 1_000, queuedMessages: [] }}
        heldCount={0}
        directComposerMessagesSend={true}
      />,
    );

    await userEvent.click(screen.getByTestId("composer-paused-chip"));

    expect(screen.getByTestId("composer-held-input-list").textContent).toContain("No held input yet.");
  });

  it("uses disconnected-session copy when direct composer sends are backend-gated", () => {
    render(
      <PausedInputChip
        pause={{ pausedAt: 1_000, queuedMessages: [] }}
        heldCount={0}
        directComposerMessagesSend={false}
      />,
    );

    expect(
      screen.getByText("Direct composer messages still need the session to resume. External input waits here."),
    ).toBeTruthy();
  });

  it("renders the fixed Copilot cause, original pause time, action, and sanitized held list", async () => {
    // Cause and timestamp come only from the closed family plus original pausedAt;
    // later errors and private held/provider data must never leak into visible copy.
    const autoPause = makeAutoPauseState();
    render(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={2}
        directComposerMessagesSend={true}
        autoPause={autoPause}
      />,
    );

    const pausedTime = new Date(autoPause.pausedAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const banner = screen.getByTestId("composer-paused-banner");
    expect(banner.className).toContain("border-cc-attention/75");
    expect(banner.className).toContain("bg-cc-attention-bg");
    expect(banner.className).toContain("text-cc-fg");
    expect(banner.className).not.toContain("text-amber-200");
    const pausedChip = screen.getByTestId("composer-paused-chip");
    expect(pausedChip.textContent).toContain("Automatic inputs paused· 2 held");
    expect(pausedChip.className).toContain("text-cc-attention-strong");
    const heldCountChip = screen.getByTestId("composer-held-count-chip");
    expect(heldCountChip.className).toContain("border-cc-attention/45");
    expect(heldCountChip.className).toContain("bg-cc-card/70");
    expect(heldCountChip.className).toContain("text-cc-attention-strong");
    expect(screen.getByText(`Cause: Copilot sign-in failed at ${pausedTime}.`)).toBeTruthy();
    expect(
      screen.getByText(
        "Sign in to Copilot again, then retry this session. Held inputs will stay paused until it succeeds.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("PRIVATE RAW PROVIDER ERROR");
    expect(document.body.textContent).not.toContain("PRIVATE FINGERPRINT");
    expect(document.body.textContent).not.toContain("PRIVATE TRUSTED ROUTE LABEL");

    await userEvent.click(screen.getByTestId("composer-paused-chip"));
    const list = screen.getByTestId("composer-held-input-list");
    expect(list.className).toContain("border-cc-attention/45");
    expect(list.className).toContain("bg-cc-card/70");
    expect(list.textContent).toContain("Herd Events");
    expect(list.textContent).toContain("Held herd event");
    expect(list.textContent).toContain("x2");
    expect(list.textContent).not.toContain("PRIVATE HELD PAYLOAD");
  });

  it("waits for authoritative release progress before disabling and disappears only after the pause clears", async () => {
    const onReleaseAutoPausedInputs = vi.fn();
    const autoPause = makeAutoPauseState("model_backend_stream_error");
    const commonProps = {
      pause: null,
      heldCount: 0,
      autoPausedHeldCount: 2,
      directComposerMessagesSend: true,
      onReleaseAutoPausedInputs,
    };
    const { rerender } = render(<PausedInputChip {...commonProps} autoPause={autoPause} />);

    const release = screen.getByTestId("composer-auto-pause-release");
    expect(release.textContent).toContain("Release now");
    expect((release as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(release);

    expect(onReleaseAutoPausedInputs).toHaveBeenCalledWith(autoPause.pausedAt);
    expect(release.textContent).toContain("Release now");
    expect((release as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <PausedInputChip
        {...commonProps}
        autoPause={{
          ...autoPause,
          releaseProgress: { status: "releasing", acceptedAt: autoPause.pausedAt! + 1_000 },
        }}
      />,
    );

    expect(screen.getByTestId("composer-auto-pause-release").textContent).toContain("Releasing…");
    expect((screen.getByTestId("composer-auto-pause-release") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("composer-auto-pause-guidance").textContent).toContain(
      "Takode accepted your request and is releasing the held inputs.",
    );

    rerender(<PausedInputChip {...commonProps} autoPause={{ ...autoPause, releaseProgress: undefined }} />);
    expect(screen.getByTestId("composer-auto-pause-release").textContent).toContain("Release now");
    expect((screen.getByTestId("composer-auto-pause-release") as HTMLButtonElement).disabled).toBe(false);

    rerender(<PausedInputChip {...commonProps} autoPause={null} autoPausedHeldCount={0} />);
    expect(screen.queryByTestId("composer-paused-banner")).toBeNull();
  });

  it("uses the repeated-stream cause and exact server-confirmed testing copy with polite mobile-safe status", () => {
    render(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={2}
        directComposerMessagesSend={true}
        autoPause={makeAutoPauseState("model_backend_stream_error")}
        autoPauseRecoveryProgress="testing"
      />,
    );

    expect(screen.getByText(/Cause: The model connection dropped repeatedly at/)).toBeTruthy();
    expect(
      screen.getByText(
        "Takode is checking this session with your current message. Held inputs will send if it finishes successfully.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Sign in to Copilot again/)).toBeNull();
    const guidance = screen.getByTestId("composer-auto-pause-guidance");
    expect(guidance.getAttribute("role")).toBe("status");
    expect(guidance.getAttribute("aria-live")).toBe("polite");
    expect(guidance.getAttribute("aria-atomic")).toBe("true");
    expect(guidance.className).toContain("break-words");
    expect(guidance.parentElement?.className).toContain("flex-wrap");
  });

  it("renders distinct exact-owner active progress without implying the held backlog was released", () => {
    render(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={2}
        directComposerMessagesSend={true}
        autoPause={makeAutoPauseState("model_backend_stream_error")}
        autoPauseRecoveryProgress="active"
      />,
    );

    expect(
      screen.getByText(
        "Your current message is running. Held automatic inputs will send when it finishes successfully.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Takode is checking this session/)).toBeNull();
    expect(screen.queryByText(/Sign in to Copilot again/)).toBeNull();
    expect(screen.getByTestId("composer-paused-chip").textContent).toContain("Automatic inputs paused· 2 held");
    const guidance = screen.getByTestId("composer-auto-pause-guidance");
    expect(guidance.getAttribute("role")).toBe("status");
    expect(guidance.getAttribute("aria-live")).toBe("polite");
    expect(guidance.getAttribute("aria-atomic")).toBe("true");
    expect(guidance.className).toContain("break-words");
    expect(guidance.parentElement?.className).toContain("flex-wrap");
  });

  it("explains terminal unsupported-model pauses without implying automatic model fallback", () => {
    render(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={1}
        directComposerMessagesSend={true}
        autoPause={makeAutoPauseState("model_not_supported")}
      />,
    );

    expect(screen.getByText(/Cause: The selected model is not available at/)).toBeTruthy();
    expect(
      screen.getByText(
        "Choose a supported model, then try again. Held inputs will stay paused until this session succeeds.",
      ),
    ).toBeTruthy();
  });

  it("renders held-idle when progress is clear and removes the banner after authoritative pause clear", () => {
    const { rerender } = render(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={2}
        directComposerMessagesSend={true}
        autoPause={makeAutoPauseState("model_backend_stream_error")}
        autoPauseRecoveryProgress={null}
      />,
    );

    expect(
      screen.getByText(
        "Takode will keep these inputs paused until this session completes a message successfully. They will then send automatically.",
      ),
    ).toBeTruthy();
    rerender(
      <PausedInputChip
        pause={null}
        heldCount={0}
        autoPausedHeldCount={0}
        directComposerMessagesSend={true}
        autoPause={null}
        autoPauseRecoveryProgress={null}
      />,
    );
    expect(screen.queryByTestId("composer-paused-chip")).toBeNull();
  });
});
