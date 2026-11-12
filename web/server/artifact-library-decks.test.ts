import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "./session-types.js";
import { ArtifactLibraryStore } from "./artifact-library-store.js";
import { ArtifactLibrary, type LibrarySessionLike } from "./artifact-library.js";
import { ARTIFACT_PLACEHOLDER_LANGUAGE } from "../shared/artifact-library.js";

/**
 * Slide decks in the artifact library, on disposable state: a published report whose Markdown opens
 * with `slides: true` is a presentation (its own kind and Library tab), a report file keeps one
 * history whether or not it is a deck, and libraries that saved decks as reports tell them apart
 * once, changing only the index (backed up first).
 */

const NOW = Date.UTC(2026, 10, 11, 18, 0);
const DECK =
  "---\nslides: true\n---\n\n# FV weekly\n\nNov 12\n\n---\n\n## Results\n\n- 31% → 44%\n\nNotes:\n\nSay why.";

let root: string;
let counter = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-decks-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function report(content: string, sourcePath: string, at: number, sessionId = "s1"): BrowserIncomingMessage {
  counter += 1;
  return {
    type: "markdown_report",
    id: `report-${counter}`,
    timestamp: at,
    content,
    threadKey: "q-1",
    source: { sessionId, reportId: `report-${counter}`, sourcePath, sha256: "x" },
  };
}

async function setup(sessions: LibrarySessionLike[]) {
  const refreshed: string[] = [];
  const store = new ArtifactLibraryStore(root, () => NOW);
  await store.load();
  const library = new ArtifactLibrary(store, {
    getSession: (id) => sessions.find((session) => session.id === id),
    listSessions: () => sessions,
    spaceFor: () => "MSI",
    refreshConversation: (id) => refreshed.push(id),
  });
  return { store, library, refreshed };
}

describe("presentations", () => {
  it("saves a slides: true report as a presentation, with its first slide as the thumbnail text", async () => {
    const session = {
      id: "s1",
      messageHistory: [report(DECK, "/r/fv-weekly.md", NOW), report("# Plan\n\nText", "/r/plan.md", NOW + 1)],
    };
    const { store, library } = await setup([session]);
    await library.backfill();

    const decks = store.list({ kind: "deck" });
    expect(decks.artifacts.map((artifact) => artifact.title)).toEqual(["FV weekly"]);
    // The thumbnail shows the first slide, not the front matter.
    expect(decks.artifacts[0]!.excerpt).toBe("# FV weekly\n\nNov 12");
    expect(decks.kinds).toEqual({ deck: 1, report: 1 });
    // Its card in the conversation knows it as a presentation.
    const projected = library.projectMessage("s1", session.messageHistory[0]!);
    expect(projected.type === "markdown_report" && projected.artifacts?.[0]?.kind).toBe("deck");
    // A presentation's versions are report content: the Markdown as published.
    const content = await store.versionContent(decks.artifacts[0]!.id, 1);
    expect(content).toMatchObject({ kind: "report", markdown: DECK, sourcePath: "/r/fv-weekly.md" });
  });

  it("keeps one history for a report file that became a deck, and collapses the older publication", async () => {
    const session = {
      id: "s1",
      messageHistory: [report("# FV weekly\n\nDraft as a document", "/r/fv-weekly.md", NOW)],
    };
    const { store, library, refreshed } = await setup([session]);
    await library.backfill();
    expect(store.list().artifacts[0]).toMatchObject({ kind: "report", versionCount: 1 });

    session.messageHistory.push(report(DECK, "/r/fv-weekly.md", NOW + 1000));
    library.sessionSaved("s1");
    await library.idle();
    expect(store.list().artifacts).toHaveLength(1);
    expect(store.list().artifacts[0]).toMatchObject({ kind: "deck", versionCount: 2 });
    expect(refreshed).toContain("s1");
    const older = library.projectMessage("s1", session.messageHistory[0]!);
    expect(older.type === "markdown_report" && older.content).toContain(ARTIFACT_PLACEHOLDER_LANGUAGE);
  });

  it("tells decks saved as reports apart once, changing only kinds and excerpts in the index", async () => {
    const deckSession = { id: "s1", messageHistory: [report(DECK, "/r/fv-weekly.md", NOW)] };
    const otherSession = { id: "s2", messageHistory: [report("# Plan\n\nText", "/r/plan.md", NOW, "s2")] };
    const first = await setup([deckSession, otherSession]);
    await first.library.backfill();

    // The index as a library from before presentations left it: the deck saved as a report.
    const indexPath = join(root, "index.json");
    const old = JSON.parse(await readFile(indexPath, "utf-8"));
    delete old.decksSeparated;
    for (const artifact of Object.values(old.artifacts) as Array<{ kind: string; excerpt: string }>) {
      if (artifact.kind === "deck") {
        artifact.kind = "report";
        artifact.excerpt = DECK.slice(0, 40);
      }
    }
    await writeFile(indexPath, JSON.stringify(old));
    const textFiles = (await readdir(join(root, "text"))).sort();

    const { store, library, refreshed } = await setup([deckSession, otherSession]);
    expect(store.needsDeckSeparation()).toBe(true);
    await library.backfill();

    expect(store.list({ kind: "deck" }).artifacts.map((artifact) => artifact.title)).toEqual(["FV weekly"]);
    expect(store.list({ kind: "deck" }).artifacts[0]!.excerpt).toBe("# FV weekly\n\nNov 12");
    expect(store.list({ kind: "report" }).artifacts.map((artifact) => artifact.title)).toEqual(["Plan"]);
    // No version was added or lost, and no saved content changed.
    expect(store.list().artifacts.map((artifact) => artifact.versionCount)).toEqual([1, 1]);
    expect((await readdir(join(root, "text"))).sort()).toEqual(textFiles);
    // The index was backed up first, as the library from before presentations wrote it.
    const backups = (await readdir(root)).filter((name) => name.startsWith("index.backup-decks-"));
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(await readFile(join(root, backups[0]!), "utf-8"));
    expect(Object.values(backup.artifacts).map((artifact) => (artifact as { kind: string }).kind)).toEqual([
      "report",
      "report",
    ]);
    // Only the conversation showing the deck is re-sent, so its card gets the new kind.
    expect(refreshed).toEqual(["s1"]);

    // Done once: a later start neither backs up nor changes anything again.
    const again = await setup([deckSession, otherSession]);
    expect(again.store.needsDeckSeparation()).toBe(false);
    await again.library.backfill();
    expect((await readdir(root)).filter((name) => name.startsWith("index.backup-decks-"))).toHaveLength(1);
    // A new library has nothing to tell apart.
    expect(first.store.needsDeckSeparation()).toBe(false);
  });

  it("merges a deck saved separately into a report, taking the kind of the newest version", async () => {
    const session = {
      id: "s1",
      messageHistory: [report("# FV weekly\n\nDocument", "/r/a.md", NOW), report(DECK, "/r/b.md", NOW + 1000)],
    };
    const { store, library } = await setup([session]);
    await library.backfill();
    const reportId = store.list({ kind: "report" }).artifacts[0]!.id;
    const deckId = store.list({ kind: "deck" }).artifacts[0]!.id;
    const merged = store.merge(deckId, reportId);
    expect(merged?.artifact).toMatchObject({ id: reportId, kind: "deck", versionCount: 2 });
    expect(merged?.artifact.excerpt).toBe("# FV weekly\n\nNov 12");
  });
});
