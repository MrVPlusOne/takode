import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("quest skill ownership docs", () => {
  function readTemplate(name: string): string {
    return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "templates", name), "utf-8");
  }

  function sectionBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    return source.slice(startIndex, endIndex);
  }

  it("documents force claim, leader reassign, and archived-owner audit compatibility", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("quest claim  <id> [--session <sid>] [--force --reason <text>] [--json]");
    expect(docs).toContain("quest reassign <id> --session <worker> --reason <text> [--json]");
    expect(docs).toContain("archived_owner_takeover");
  });

  it("documents owning-leader completion recovery as an audited exception", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("Owning-leader completion recovery is a future escape hatch, not the nominal path");
    expect(docs).toContain("Prefer ordinary worker completion or `quest reassign`");
    expect(docs).toContain("records an explicit recovery audit event");
  });

  it("documents Questmaster data safety for destructive helpers", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("## Questmaster Data Safety");
    expect(docs).toContain("Questmaster records are durable shared user data");
    expect(docs).toContain("reset/delete/migration helpers");
    expect(docs).toContain("isolated temporary/disposable state");
    expect(docs).toContain("backup, snapshot, or recovery plan and approval");
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

  it("documents compact phase handoffs without weakening durable phase notes", () => {
    const docs = readTemplate("quest-skill-docs.md");

    expect(docs).toContain("Keep final chat handoffs much shorter than the phase note");
    expect(docs).toContain("Questmaster phase feedback as the source of truth for detailed results");
    expect(docs).toContain("name the phase feedback index");
    expect(docs).toContain("User Checkpoint packets");
    expect(docs).toContain("Work's selected target plus ordered `Synced SHAs:`");
    expect(docs).toContain("final Memory's required memory statement");
    expect(docs).toContain("After a successful Work -> Memory transition, stop the Work turn");
    expect(docs).toContain("the leader can report the accepted outcome immediately");
    expect(docs).toContain("Final Memory resumes under the Memory phase brief and remains mandatory");
  });

  it("documents the generic two-axis tag taxonomy with mocked non-examples", () => {
    const docs = readTemplate("quest-skill-docs.md");
    const tagsSection = sectionBetween(docs, "## Tags", "## Images");

    expect(tagsSection).toContain("Use a small generic two-axis taxonomy by default");
    expect(tagsSection).toContain(
      "Default area tags: `ui`, `backend`, `cli`, `orchestration`, `data`, `ml`, `infra`, `security`.",
    );
    expect(tagsSection).toContain(
      "Default work-type tags: `bugfix`, `feature`, `improvement`, `investigation`, `validation`, `refactor`, `docs`, `cleanup`, `ops`.",
    );
    expect(tagsSection).toContain("project-alpha");
    expect(tagsSection).toContain("pipeline-widget");
    expect(tagsSection).toContain("status-panel");
    expect(tagsSection).toContain("bridge-adapter");
    expect(tagsSection).toContain("public instruction examples");
    expect(tagsSection).not.toContain("Common patterns: component/area");
  });

  it("keeps public tag examples aligned with the taxonomy guidance", () => {
    const docs = readTemplate("quest-skill-docs.md");

    // Guard stale copyable examples outside the main Tags section too. These
    // examples are intentionally narrow so public docs do not teach old
    // component/project-tag or third-tag patterns by accident.
    expect(docs).not.toContain('--tags "questmaster,cli"');
    expect(docs).not.toContain('--tags "ui,bugfix,mobile"');
    expect(docs).not.toContain("Common patterns: component/area");
    expect(docs).not.toContain("Reuse existing tags. Only create new tags when no existing tag fits.");

    const areaTags = new Set(["ui", "backend", "cli", "orchestration", "data", "ml", "infra", "security"]);
    const workTypeTags = new Set([
      "bugfix",
      "feature",
      "improvement",
      "investigation",
      "validation",
      "refactor",
      "docs",
      "cleanup",
      "ops",
    ]);
    const concreteTagExamples = [...docs.matchAll(/--tags "([^"]+)"/g)]
      .map((match) => match[1])
      .filter((tags) => tags !== "t1,t2");

    expect(concreteTagExamples.length).toBeGreaterThan(0);

    for (const tagExample of concreteTagExamples) {
      const [areaTag, workTypeTag, extraTag] = tagExample.split(",");

      expect(extraTag, `${tagExample} should use only an area tag and a work-type tag`).toBeUndefined();
      expect(areaTags.has(areaTag ?? ""), `${tagExample} should start with a default area tag`).toBe(true);
      expect(workTypeTags.has(workTypeTag ?? ""), `${tagExample} should end with a default work-type tag`).toBe(true);
    }
  });
});
