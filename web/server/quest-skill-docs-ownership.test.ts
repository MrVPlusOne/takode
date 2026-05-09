import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("quest skill ownership docs", () => {
  it("documents force claim, leader reassign, and archived-owner audit compatibility", () => {
    const docs = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "templates", "quest-skill-docs.md"),
      "utf-8",
    );

    expect(docs).toContain("quest claim  <id> [--session <sid>] [--force --reason <text>] [--json]");
    expect(docs).toContain("quest reassign <id> --session <worker> --reason <text> [--json]");
    expect(docs).toContain("archived_owner_takeover");
  });
});
