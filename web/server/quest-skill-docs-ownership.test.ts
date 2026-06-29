import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("quest skill ownership docs", () => {
  function readTemplate(name: string): string {
    return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "templates", name), "utf-8");
  }

  it("documents force claim, leader reassign, and archived-owner audit compatibility", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("quest claim  <id> [--session <sid>] [--force --reason <text>] [--json]");
    expect(docs).toContain("quest reassign <id> --session <worker> --reason <text> [--json]");
    expect(docs).toContain("archived_owner_takeover");
  });

  it("documents User review checks as optional Memory-settled user-owned checks", () => {
    const docs = readTemplate("quest-skill-docs.md");
    const memoryCompletion = readTemplate("quest-memory-completion.md");

    expect(docs).toContain("User review checks are optional human-owned checks only");
    expect(docs).toContain("Final Memory is mandatory for every non-cancelled Quest Journey");
    expect(memoryCompletion).toContain("User review checks are optional human-owned checks only");
    expect(docs).toContain("an empty list is normal when no user action remains");
    expect(memoryCompletion).toContain(
      "Empty User review checks are normal and preferred over invented checklist entries",
    );
    expect(docs).not.toContain("Verification items must be human-checkable acceptance items only");
  });

  it("documents memory commit metadata as separate from code commit metadata", () => {
    const docs = readTemplate("quest-skill-docs.md");
    const memoryCompletion = readTemplate("quest-memory-completion.md");

    expect(docs).toContain("[--memory-commit <sha>] [--memory-commits");
    expect(docs).toContain(
      "| `--commit <sha>` | Attach one code repo commit SHA (repeatable). Use this for synced code/docs/template commits, not memory repo commits. |",
    );
    expect(docs).toContain(
      "| `--memory-commit <sha>` | Attach one memory repo commit SHA (repeatable). Use this for file-based memory commits, not code repo commits. |",
    );
    expect(docs).toContain("Keep these separate from code repo commits.");
    expect(memoryCompletion).toContain("Keep code commit metadata separate from memory commit metadata");
    expect(memoryCompletion).toContain("file-based memory repo commits");
  });

  it("documents quest show progressive reveal before expensive full detail", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("quest show   <id> [--sections <list>] [--full] [--json]");
    expect(docs).toContain("Plain-text `quest show q-N` is compact by default");
    expect(docs).toContain("quest show q-12 --sections description,debrief");
    expect(docs).toContain("quest show q-12 --sections phases");
    expect(docs).toContain("quest show q-12 --sections phase:7");
    expect(docs).toContain("Prefer targeted `--sections` reveals first.");
  });
});
