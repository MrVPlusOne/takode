import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LauncherStateFile } from "./launcher-state-file.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "launcher-state-file-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const listOnDisk = async () => JSON.parse(await readFile(join(dir, "launcher.json"), "utf-8"));
const instructionsOnDisk = async (sessionId: string) =>
  JSON.parse(await readFile(join(dir, "launch-instructions", `${sessionId}.json`), "utf-8"));
const instructionFiles = async () => (await readdir(join(dir, "launch-instructions")).catch(() => [])).sort();

describe("LauncherStateFile", () => {
  it("keeps launch instructions out of launcher.json and joins them back on load", async () => {
    // The list is rewritten on every state change, so the bulky instructions must not be in it.
    const file = new LauncherStateFile(dir);
    const snapshot = { files: [{ path: "/a/AGENTS.md", contents: "rules" }] };
    const sessions = [
      { sessionId: "s1", state: "connected", injectedSystemPrompt: "prompt one" },
      { sessionId: "s2", state: "exited", codexInstructionSnapshot: snapshot },
      { sessionId: "s3", state: "exited" },
    ];
    await file.save(sessions);

    expect(await listOnDisk()).toEqual([
      { sessionId: "s1", state: "connected" },
      { sessionId: "s2", state: "exited" },
      { sessionId: "s3", state: "exited" },
    ]);
    expect(await instructionsOnDisk("s1")).toEqual({ injectedSystemPrompt: "prompt one" });
    expect(await instructionsOnDisk("s2")).toEqual({ codexInstructionSnapshot: snapshot });
    expect(await instructionFiles()).toEqual(["s1.json", "s2.json"]);

    // A fresh instance (a restart) reads the full entries back.
    expect(await new LauncherStateFile(dir).load()).toEqual(sessions);
    // Callers that only need states skip the instruction files.
    expect(await new LauncherStateFile(dir).loadList()).toEqual(await listOnDisk());
  });

  it("rewrites a session's instructions only when they change", async () => {
    const file = new LauncherStateFile(dir);
    const session = { sessionId: "s1", state: "starting", injectedSystemPrompt: "first launch" };
    await file.save([session]);
    // Make any rewrite visible in the file's content, not just its timestamp.
    await writeFile(join(dir, "launch-instructions", "s1.json"), JSON.stringify({ injectedSystemPrompt: "marker" }));

    session.state = "connected";
    await file.save([session]);
    expect(await instructionsOnDisk("s1")).toEqual({ injectedSystemPrompt: "marker" });
    expect((await listOnDisk())[0].state).toBe("connected");

    session.injectedSystemPrompt = "relaunch";
    await file.save([session]);
    expect(await instructionsOnDisk("s1")).toEqual({ injectedSystemPrompt: "relaunch" });
  });

  it("does not rewrite instructions it loaded", async () => {
    await new LauncherStateFile(dir).save([{ sessionId: "s1", injectedSystemPrompt: "kept" }]);
    await writeFile(join(dir, "launch-instructions", "s1.json"), JSON.stringify({ injectedSystemPrompt: "on disk" }));

    const restarted = new LauncherStateFile(dir);
    const [entry] = (await restarted.load<Array<Record<string, unknown>>>())!;
    expect(entry!.injectedSystemPrompt).toBe("on disk");
    await restarted.save([{ ...entry, state: "connected" }]);
    expect(await instructionsOnDisk("s1")).toEqual({ injectedSystemPrompt: "on disk" });
  });

  it("moves instructions out of a list saved before the split", async () => {
    // Coordinators upgrading keep the instructions inline until their first save.
    await writeFile(
      join(dir, "launcher.json"),
      JSON.stringify([{ sessionId: "old", state: "exited", injectedSystemPrompt: "inline prompt" }]),
    );
    const file = new LauncherStateFile(dir);
    const loaded = (await file.load<Array<Record<string, unknown>>>())!;
    expect(loaded[0]!.injectedSystemPrompt).toBe("inline prompt");

    await file.save(loaded);
    expect(await listOnDisk()).toEqual([{ sessionId: "old", state: "exited" }]);
    expect(await instructionsOnDisk("old")).toEqual({ injectedSystemPrompt: "inline prompt" });
  });

  it("deletes the instructions of sessions that leave the list or lose them", async () => {
    const file = new LauncherStateFile(dir);
    await file.save([
      { sessionId: "gone", injectedSystemPrompt: "a" },
      { sessionId: "cleared", injectedSystemPrompt: "b" },
      { sessionId: "kept", injectedSystemPrompt: "c" },
    ]);
    expect(await instructionFiles()).toEqual(["cleared.json", "gone.json", "kept.json"]);

    await file.save([{ sessionId: "cleared" }, { sessionId: "kept", injectedSystemPrompt: "c" }]);
    expect(await instructionFiles()).toEqual(["kept.json"]);
    expect(await new LauncherStateFile(dir).load()).toEqual([
      { sessionId: "cleared" },
      { sessionId: "kept", injectedSystemPrompt: "c" },
    ]);
  });

  it("snapshots the list when saved and writes saves in order", async () => {
    const file = new LauncherStateFile(dir);
    const session = { sessionId: "s1", state: "starting" };
    const first = file.save([session]);
    session.state = "connected";
    const second = file.save([session]);
    await first;
    await second;
    expect(await listOnDisk()).toEqual([{ sessionId: "s1", state: "connected" }]);
  });

  it("passes non-list data through unchanged", async () => {
    const file = new LauncherStateFile(dir);
    await file.save({ some: "launcher data" });
    expect(await file.load()).toEqual({ some: "launcher data" });
    expect(await new LauncherStateFile(join(dir, "missing")).load()).toBeNull();
  });
});
