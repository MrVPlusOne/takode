// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { ModelProvenanceMigrationBanner } from "./ModelProvenanceMigrationBanner.js";

describe("ModelProvenanceMigrationBanner", () => {
  it("prominently explains the persisted unknown-provenance choice", () => {
    render(
      <ModelProvenanceMigrationBanner
        migration={{
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
        }}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Model provenance migrated");
    expect(banner).toHaveTextContent("Original model provenance was unavailable");
    expect(banner).toHaveTextContent("gpt-5.6-sol");
  });
});
