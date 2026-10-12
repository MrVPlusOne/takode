import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addSessionCopy,
  listSessionCopies,
  removeSessionCopies,
  type SessionCopyPaths,
} from "./validation-session-copy.js";

// Validation slots are shared by whoever holds them next. Workers used to copy a
// live session in by replacing the slot's launcher list, dropping the sessions
// others had left there. These tests use only temporary directories standing in
// for live state and a slot HOME; they never touch real data.

const tempDirs: string[] = [];
const LEADER = "188a55a7-7eb4-4ca0-a351-b8986242948f";
const OTHER = "d8876225-b576-40ba-ba3b-2253b1fe5707";
const SLOT_ONLY = "fd3a2cd3-3d99-4005-ac09-a3d79f63bbf8";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function fixture(): Promise<SessionCopyPaths> {
  const root = await mkdtemp(join(tmpdir(), "validation-session-copy-"));
  tempDirs.push(root);
  const live = join(root, "live", ".companion");
  const slotHome = join(root, "slot", "home");
  const paths: SessionCopyPaths = {
    liveCompanionDir: live,
    liveSessionsRoot: join(live, "sessions"),
    slotCompanionDir: join(slotHome, ".companion"),
    slotSessionsDir: join(slotHome, ".companion", "sessions", "3471"),
    manifestPath: join(slotHome, "copied-sessions.json"),
  };
  await mkdir(liveDir(paths), { recursive: true });
  // Another server's sessions, which lookups must not confuse with the live ones.
  await mkdir(join(paths.liveSessionsRoot, "9999"), { recursive: true });
  await writeJson(join(paths.liveSessionsRoot, "9999", "launcher.json"), [
    { sessionId: "aaaa0000-test", sessionNum: 7 },
  ]);
  await mkdir(paths.slotSessionsDir, { recursive: true });

  // Live: a leader with chunked history, images and named quests, plus a second session.
  const liveLauncher = [
    {
      sessionId: LEADER,
      sessionNum: 2851,
      state: "connected",
      pid: 4242,
      cliSessionId: "live-resume-id",
      hostProcId: "live-host-proc",
      sessionAuthToken: "live-token",
      injectedSystemPrompt: "prompt",
      isOrchestrator: true,
    },
    { sessionId: OTHER, sessionNum: 2970, state: "connected", pid: 4343, sessionAuthToken: "other-token" },
  ];
  await writeJson(join(liveDir(paths), "launcher.json"), liveLauncher);
  await writeJson(join(liveDir(paths), `${LEADER}.json`), {
    id: LEADER,
    _historyRef: { generation: "gen-1" },
    state: {
      backend_state: "connected",
      leaderOpenThreadTabs: { orderedOpenThreadKeys: ["q-10", "q-11"] },
    },
    board: [{ questId: "q-12" }],
    completedBoard: [{ questId: "q-10" }],
  });
  await writeFile(join(liveDir(paths), `${LEADER}.history-gen-1.data`), "chunk");
  await writeFile(join(liveDir(paths), `${LEADER}.history.jsonl`), "{}\n");
  await writeJson(join(liveDir(paths), `${OTHER}.json`), { id: OTHER, state: {} });
  await mkdir(join(live, "images", LEADER), { recursive: true });
  await writeFile(join(live, "images", LEADER, "shot.jpeg"), "jpeg");
  await mkdir(join(live, "questmaster-live"), { recursive: true });
  await writeJson(join(live, "questmaster-live", "store.json"), {
    format: "quest-store",
    version: 1,
    nextQuestNumber: 20,
    quests: ["q-1", "q-10", "q-11", "q-12", "q-13"].map((questId) => ({ questId, title: `live ${questId}` })),
  });
  await writeJson(join(live, "session-names.json"), {
    names: { [LEADER]: "DevBox takode" },
    leaderCounter: 3,
    userNamed: [LEADER],
  });

  // Slot: another worker's session and quest q-10, which must survive every change.
  await writeJson(join(paths.slotSessionsDir, "launcher.json"), [{ sessionId: SLOT_ONLY, sessionNum: 1 }]);
  await writeJson(join(paths.slotSessionsDir, `${SLOT_ONLY}.json`), { id: SLOT_ONLY });
  await mkdir(join(paths.slotCompanionDir, "questmaster-live"), { recursive: true });
  await writeJson(join(paths.slotCompanionDir, "questmaster-live", "store.json"), {
    format: "quest-store",
    version: 1,
    nextQuestNumber: 3,
    quests: [{ questId: "q-10", title: "slot's own q-10" }],
  });
  return paths;
}

describe("validation session copies", () => {
  it("merges a copy into the slot, keeps what others left, and can never run the live backend", async () => {
    const paths = await fixture();
    const liveBefore = await snapshotDir(paths.liveCompanionDir);

    const record = await addSessionCopy(paths, "#2851");

    expect(record).toMatchObject({ sessionId: LEADER, sessionNum: 2851, images: true, addedName: true });
    expect(record.files.sort()).toEqual(
      [`${LEADER}.history-gen-1.data`, `${LEADER}.history.jsonl`, `${LEADER}.json`].sort(),
    );

    const launcher = await readJson(join(paths.slotSessionsDir, "launcher.json"));
    expect(launcher.map((entry: { sessionId: string }) => entry.sessionId)).toEqual([SLOT_ONLY, LEADER]);
    const copied = launcher[1];
    // No process, resume ID, host process or live token; a fresh token for the slot.
    expect(copied).toMatchObject({ state: "exited", sessionNum: 2851, isOrchestrator: true });
    for (const field of ["pid", "cliSessionId", "hostProcId", "injectedSystemPrompt"])
      expect(copied).not.toHaveProperty(field);
    expect(copied.sessionAuthToken).not.toBe("live-token");

    const session = await readJson(join(paths.slotSessionsDir, `${LEADER}.json`));
    expect(session.state.backend_state).toBe("disconnected");
    expect(session.state.pause).toMatchObject({ reason: "validation copy", queuedMessages: [] });

    // Only quests the slot lacked are added; the slot's own q-10 stays its own.
    const store = await readJson(join(paths.slotCompanionDir, "questmaster-live", "store.json"));
    expect(store.quests).toEqual([
      { questId: "q-10", title: "slot's own q-10" },
      { questId: "q-11", title: "live q-11" },
      { questId: "q-12", title: "live q-12" },
    ]);
    expect(store.nextQuestNumber).toBe(13);
    expect(record.addedQuestIds).toEqual(["q-11", "q-12"]);
    expect(await readFile(join(paths.slotCompanionDir, "images", LEADER, "shot.jpeg"), "utf-8")).toBe("jpeg");

    // Live state is read only.
    expect(await snapshotDir(paths.liveCompanionDir)).toEqual(liveBefore);
  });

  it("removes exactly what a copy added and leaves the rest of the slot alone", async () => {
    const paths = await fixture();
    await addSessionCopy(paths, LEADER.slice(0, 8));
    await addSessionCopy(paths, "2970");
    expect((await listSessionCopies(paths)).map((record) => record.sessionNum)).toEqual([2851, 2970]);

    // While running, the slot server saves the copy's history under a new chunk name.
    await writeFile(join(paths.slotSessionsDir, `${LEADER}.history-gen-2.data`), "rewritten");

    const removed = await removeSessionCopies(paths, "#2851");

    expect(removed.map((record) => record.sessionId)).toEqual([LEADER]);
    const launcher = await readJson(join(paths.slotSessionsDir, "launcher.json"));
    expect(launcher.map((entry: { sessionId: string }) => entry.sessionId)).toEqual([SLOT_ONLY, OTHER]);
    expect((await readdir(paths.slotSessionsDir)).sort()).toEqual(
      ["launcher.json", `${SLOT_ONLY}.json`, `${OTHER}.json`].sort(),
    );
    const store = await readJson(join(paths.slotCompanionDir, "questmaster-live", "store.json"));
    expect(store.quests.map((quest: { questId: string }) => quest.questId)).toEqual(["q-10"]);
    const names = await readJson(join(paths.slotCompanionDir, "session-names.json"));
    expect(names.names).toEqual({});
    await expect(readdir(join(paths.slotCompanionDir, "images", LEADER))).rejects.toThrow();

    await removeSessionCopies(paths, "all");
    expect(await readJson(join(paths.slotSessionsDir, "launcher.json"))).toEqual([
      { sessionId: SLOT_ONLY, sessionNum: 1 },
    ]);
    expect(await listSessionCopies(paths)).toEqual([]);
  });

  it("refuses a second copy of the same session, a taken session number, or a missing history chunk", async () => {
    const paths = await fixture();
    await addSessionCopy(paths, "#2851");
    await expect(addSessionCopy(paths, "#2851")).rejects.toThrow(/already holds session/);

    const numberTaken = await fixture();
    await writeJson(join(numberTaken.slotSessionsDir, "launcher.json"), [{ sessionId: SLOT_ONLY, sessionNum: 2851 }]);
    await expect(addSessionCopy(numberTaken, "#2851")).rejects.toThrow(/numbered #2851/);

    // The live server saved a new history generation between reading the session and copying.
    const racing = await fixture();
    await rm(join(liveDir(racing), `${LEADER}.history-gen-1.data`));
    await expect(addSessionCopy(racing, "#2851")).rejects.toThrow(/run add-session again/);
    expect(await readdir(racing.slotSessionsDir)).not.toContain(`${LEADER}.history.jsonl`);
    expect(await listSessionCopies(racing)).toEqual([]);
  });

  it("refuses to write into live state", async () => {
    const paths = await fixture();
    const intoLive = { ...paths, slotCompanionDir: paths.liveCompanionDir, slotSessionsDir: liveDir(paths) };
    await expect(addSessionCopy(intoLive, "#2851")).rejects.toThrow(/overlaps live state/);
    await expect(removeSessionCopies(intoLive, "all")).rejects.toThrow(/overlaps live state/);
  });
});

function liveDir(paths: SessionCopyPaths): string {
  return join(paths.liveSessionsRoot, "3456");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value));
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf-8"));
}

/** Every file under `dir` with its contents, to prove a directory was not changed. */
async function snapshotDir(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path] = await readFile(path, "utf-8");
  }
  return files;
}
