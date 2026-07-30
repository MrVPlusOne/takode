// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import type { ModelProvenanceMigration } from "../types.js";
import { ModelProvenanceMigrationBanner } from "./ModelProvenanceMigrationBanner.js";

function migration(overrides: Partial<ModelProvenanceMigration> = {}): ModelProvenanceMigration {
  return {
    eventId: "model-provenance-migration:test-event",
    code: "model_provenance_unavailable",
    source: "legacy_relaunch",
    selectedModel: "gpt-5.6-sol",
    authority: {
      model: "gpt-5.6-sol",
      source: "session_default",
      policyVersion: "test",
      overrideTrace: [
        {
          model: "gpt-5.6-sol",
          source: "session_default",
          precedence: 300,
          status: "selected",
        },
      ],
    },
    migratedAt: 123,
    warning: "Original model provenance was unavailable. Takode persisted gpt-5.6-sol.",
    ...overrides,
  };
}

describe("ModelProvenanceMigrationBanner", () => {
  it("uses a compact accessible summary with keyboard-native optional details", () => {
    render(<ModelProvenanceMigrationBanner migration={migration()} onAcknowledge={vi.fn()} />);

    const notice = screen.getByRole("status", { name: "Model provenance migration notice" });
    expect(notice).toHaveTextContent("Takode preserved gpt-5.6-sol for this session family");
    expect(notice).toHaveClass("py-1.5");
    const details = notice.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Details"));
    expect(details).toHaveAttribute("open");
    expect(notice).toHaveTextContent("Original model provenance was unavailable");
    expect(screen.getByRole("button", { name: "Dismiss model provenance migration notice" })).toBeEnabled();
  });

  it("names the exact event and stays visible until authoritative props acknowledge it", async () => {
    // Resolving the HTTP request alone is not authoritative; only the later server-authored prop hides the notice.
    let resolveRequest!: () => void;
    const onAcknowledge = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const view = render(<ModelProvenanceMigrationBanner migration={migration()} onAcknowledge={onAcknowledge} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss model provenance migration notice" }));
    expect(onAcknowledge).toHaveBeenCalledWith("model-provenance-migration:test-event");
    expect(screen.getByTestId("model-provenance-migration-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss model provenance migration notice" })).toBeDisabled();

    await act(async () => resolveRequest());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dismiss model provenance migration notice" })).toBeEnabled(),
    );
    expect(screen.getByTestId("model-provenance-migration-banner")).toBeInTheDocument();

    view.rerender(
      <ModelProvenanceMigrationBanner migration={migration({ acknowledgedAt: 456 })} onAcknowledge={onAcknowledge} />,
    );
    expect(screen.queryByTestId("model-provenance-migration-banner")).toBeNull();
  });

  it("keeps the notice visible and announces an acknowledgement failure", async () => {
    render(
      <ModelProvenanceMigrationBanner
        migration={migration()}
        onAcknowledge={() => Promise.reject(new Error("Migration event changed"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss model provenance migration notice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Migration event changed");
    expect(screen.getByTestId("model-provenance-migration-banner")).toBeInTheDocument();
  });
});
