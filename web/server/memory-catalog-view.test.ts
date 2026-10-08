import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMemoryHandle, renderMemoryCatalogView, RECENT_NOTE_LIMIT } from "./memory-catalog-view.js";
import { writeHelpfulMarks } from "./memory-repo-layout.js";
import { scanMemoryCatalog } from "./workstream-memory-store.js";

const execFileAsync = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), "memory-catalog-view-")), "repo");
  await mkdir(root, { recursive: true });
  await execFileAsync("git", ["-C", root, "init", "-q"]);
});

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

async function note(path: string, fields: Record<string, string>, body = "Body."): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  const frontmatter = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  await writeFile(join(root, path), ["---", ...frontmatter, "source:", "  - q-1", "---", "", body, ""].join("\n"));
}

async function readme(folder: string, description: string): Promise<void> {
  await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, folder, "README.md"), `---\ndescription: "${description}"\n---\n`);
}

const catalog = () => scanMemoryCatalog({ root });

describe("memory catalog view", () => {
  it("lists recently touched notes and one line per top-level folder, with a handle", async () => {
    // The recent list ranks by last touch (edit or helpful mark), always pins `current` notes and
    // leaves evidence/reference notes to their folders; folder lines count notes and recent ones.
    await readme("codex", "Read for Codex: recovery and models.");
    await note("codex/old-decision.md", { description: '"Read when old."', type: "decision", updated: "2026-01-01" });
    await note("codex/new-decision.md", { description: '"Read when new."', type: "decision", updated: "2026-09-01" });
    await note("codex/evidence.md", { description: '"Read for evidence."', type: "artifact", updated: "2026-10-01" });
    await note("codex/live.md", { description: '"Read for live state."', type: "current", updated: "2025-01-01" });
    await writeHelpfulMarks(root, { "codex/old-decision.md": "2026-10-02" });

    const view = await renderMemoryCatalogView(await catalog(), { mode: "overview" });

    const recent = view.text.split("\n").filter((line) => line.startsWith("codex/") && line.includes(".md:"));
    expect(recent).toEqual([
      "codex/live.md: Read for live state.",
      "codex/new-decision.md: Read when new.",
      "codex/old-decision.md: Read when old.",
    ]);
    expect(view.text).toContain("codex/ (4 notes; 3 in recent list): Read for Codex: recovery and models.");
    expect(view.handle).toMatch(/^mem-[0-9a-f]{10}$/);
    expect(
      view.text.endsWith(`[memory handle: ${view.handle}. Pass --seen ${view.handle} to your next memory read.]`),
    ).toBe(true);
  });

  // The overview tells the reader where its session and the memory repo are,
  // right under the repo line; folder listings do not repeat it.
  it("shows the machine line under the repo line in the overview only", async () => {
    await note("topic/a.md", { description: '"Read when a."', type: "decision", updated: "2026-09-01" });
    const machine = "This session runs on machine `devbox`.";
    const overview = await renderMemoryCatalogView(await catalog(), { mode: "overview" }, { machine });
    const lines = overview.text.split("\n");
    expect(lines[0]).toMatch(/^Memory repo: /);
    expect(lines[1]).toBe(machine);
    const folder = await renderMemoryCatalogView(await catalog(), { mode: "folder", folder: "topic" }, { machine });
    expect(folder.text).not.toContain(machine);
  });

  // Every note records its machines; to stay small, the catalog names the most common
  // machine once and tags only notes written elsewhere or on several machines.
  it("tags notes not written on the repo's default machine alone", async () => {
    const fields = (machines: string) => ({ description: '"Read when x."', type: "decision", machines });
    await note("topic/a.md", fields("[laptop]"));
    await note("topic/b.md", fields("[laptop]"));
    await note("topic/c.md", fields("[devbox]"));
    await note("topic/d.md", fields("[laptop, devbox]"));
    await note("topic/e.md", { description: '"Read when x."', type: "decision" });

    const expected = [
      "Notes were written on machine `laptop` unless tagged with other machines after the path, like `note.md [other-machine]`.",
      "topic/a.md: Read when x.",
      "topic/b.md: Read when x.",
      "topic/c.md [devbox]: Read when x.",
      "topic/d.md [laptop, devbox]: Read when x.",
      "topic/e.md [unknown machine]: Read when x.",
    ];
    for (const request of [{ mode: "overview" }, { mode: "folder", folder: "topic" }, { mode: "all" }] as const) {
      const lines = (await renderMemoryCatalogView(await catalog(), request)).text.split("\n");
      expect({ request, lines: lines.filter((line) => expected.includes(line)) }).toEqual({ request, lines: expected });
    }

    // When the default machine changes, lines whose tag changed are shown again despite --seen.
    const first = await renderMemoryCatalogView(await catalog(), { mode: "folder", folder: "topic" });
    await note("topic/f.md", fields("[devbox]"));
    await note("topic/g.md", fields("[devbox]"));
    const second = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "topic" },
      { seen: first.handle },
    );
    expect(second.text).toContain("Notes were written on machine `devbox`");
    expect(second.text).toContain("topic/a.md [laptop]: Read when x.");
    expect(second.text).toContain("topic/f.md: Read when x.");
    expect(second.text).not.toContain("topic/d.md");
  });

  it("leaves notes untagged while no note records a machine", async () => {
    await note("topic/a.md", { description: '"Read when a."', type: "decision" });
    const view = await renderMemoryCatalogView(await catalog(), { mode: "overview" });
    expect(view.text).not.toContain("machine");
    expect(view.text).toContain("topic/a.md: Read when a.");
  });

  it("caps the recent list and ranks by the later of edit and helpful dates", async () => {
    for (let index = 0; index < RECENT_NOTE_LIMIT + 2; index++) {
      const day = String(1 + (index % 28)).padStart(2, "0");
      await note(`topic/note-${String(index).padStart(2, "0")}.md`, {
        description: `"Read for note ${index}."`,
        type: "knowledge",
        updated: `2026-0${1 + Math.floor(index / 28)}-${day}`,
      });
    }
    // note-00 is the oldest edit, but a recent helpful mark counts as touching it.
    await writeHelpfulMarks(root, { "topic/note-00.md": "2026-12-31" });

    const view = await renderMemoryCatalogView(await catalog(), { mode: "overview" });
    const listed = view.text.split("\n").filter((line) => line.startsWith("topic/note-"));
    expect(listed).toHaveLength(RECENT_NOTE_LIMIT);
    expect(listed.some((line) => line.startsWith("topic/note-00.md"))).toBe(true);
    expect(listed.some((line) => line.startsWith("topic/note-01.md"))).toBe(false);
  });

  it("omits entries already shown under a handle, counts them, and reprints changed ones", async () => {
    await readme("voice", "Read for voice.");
    await note("voice/a.md", { description: '"Read when a."', type: "decision", updated: "2026-09-01" });
    await note("voice/b.md", { description: '"Read when b."', type: "artifact", updated: "2026-09-01" });

    const first = await renderMemoryCatalogView(await catalog(), { mode: "overview" });
    // a.md was shown in the recent list; b.md (artifact) was not.
    const listing = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: first.handle },
    );
    expect(listing.text).not.toContain("voice/a.md");
    expect(listing.text).toContain("voice/b.md: Read when b.");
    expect(listing.omitted).toBe(1);
    expect(listing.text).toContain("1 entry omitted as already shown");

    const again = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: listing.handle },
    );
    expect(again.omitted).toBe(2);
    expect(again.handle).toBe(listing.handle); // Nothing new shown: the same set, the same handle.

    await note("voice/a.md", { description: '"Read when a changed."', type: "decision", updated: "2026-09-02" });
    const changed = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: listing.handle },
    );
    expect(changed.text).toContain("voice/a.md: Read when a changed.");
    expect(changed.omitted).toBe(1);
  });

  it("keeps handles independent, so a subagent's reads never change the parent's", async () => {
    await note("voice/a.md", { description: '"Read when a."', type: "artifact" });
    await note("voice/b.md", { description: '"Read when b."', type: "artifact" });
    const parent = await renderMemoryCatalogView(await catalog(), { mode: "overview" });

    // A subagent handed the parent's handle lists the folder and gets its own newer handle.
    const child = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: parent.handle },
    );
    expect(child.omitted).toBe(0);
    // The parent still holds its own handle and sees the full listing.
    const parentListing = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: parent.handle },
    );
    expect(parentListing.omitted).toBe(0);
    expect(parentListing.text).toContain("voice/a.md");
  });

  it("falls back to full output for unknown handles and stores each set once", async () => {
    await note("voice/a.md", { description: '"Read when a."', type: "decision" });
    const view = await renderMemoryCatalogView(
      await catalog(),
      { mode: "folder", folder: "voice" },
      { seen: "mem-0000000000" },
    );
    expect(view.unknownHandle).toBe(true);
    expect(view.text).toContain("voice/a.md");
    expect(view.text).toContain("unknown handle mem-0000000000; showing full output.");

    await renderMemoryCatalogView(await catalog(), { mode: "folder", folder: "voice" });
    expect(await readdir(join(root, ".git", "takode-memory-handles"))).toHaveLength(1);
  });

  it("names subfolders in a parent's line and lists them when the parent is listed", async () => {
    await readme("codex", "Read for Codex.");
    await readme("codex/recovery", "Read for Codex recovery.");
    await note("codex/recovery/policy.md", { description: '"Read when recovering."', type: "decision" });
    await note("codex/setup.md", { description: '"Read when setting up."', type: "procedure" });

    const overview = await renderMemoryCatalogView(await catalog(), { mode: "overview" });
    expect(overview.text).toContain("codex/ (2 notes; 2 in recent list; subfolders: recovery): Read for Codex.");
    const listing = await renderMemoryCatalogView(await catalog(), { mode: "folder", folder: "codex" });
    expect(listing.text).toContain("codex/recovery/ (1 note): Read for Codex recovery.");
    expect(listing.text).toContain("codex/setup.md: Read when setting up.");
    await expect(renderMemoryCatalogView(await catalog(), { mode: "folder", folder: "nope" })).rejects.toThrow(
      'No memory folder "nope"',
    );
  });

  it("issues handles for arbitrary keyed lines, as catalog diff does", async () => {
    const lines = [{ text: "header" }, { text: "x.md: changed", key: "x.md", version: "v2" }];
    const first = await applyMemoryHandle(root, lines);
    const second = await applyMemoryHandle(root, lines, { seen: first.handle });
    expect(second.omitted).toBe(1);
    expect(second.text.split("\n")[0]).toBe("header");
  });
});
