import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { replaceSessionFile, writeFrozenHistory } from "./session-persistence-io.js";
import type { PersistedSession } from "./session-store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "persistence-io-"));
  roots.push(root);
  return root;
}

it("preserves the old active file and cleans the candidate after a partial replacement failure", async () => {
  // Throw after a complete chunk has actually reached the candidate file.
  const root = await setup();
  const path = join(root, "session.json");
  await writeFile(path, "previous snapshot");
  function* chunks() {
    yield "x".repeat(70000);
    throw new Error("injected serialization failure");
  }
  await expect(replaceSessionFile(path, chunks())).rejects.toThrow("injected serialization failure");
  expect(await readFile(path, "utf8")).toBe("previous snapshot");
  expect(await readdir(root)).toEqual(["session.json"]);
});

it("rolls a failed multi-chunk append back to its exact original prefix", async () => {
  const root = await setup();
  const path = join(root, "session.history.jsonl");
  const old = JSON.stringify({ v: 1, sessionId: "session" }) + "\n";
  await writeFile(path, old);
  const messages = [
    { type: "user_message", content: "x".repeat(70000), timestamp: 1 },
    {
      toJSON() {
        throw new Error("later record failed");
      },
    },
  ] as unknown as PersistedSession["messageHistory"];
  await expect(writeFrozenHistory(path, "session", messages, [], true)).rejects.toThrow("later record failed");
  expect(await readFile(path, "utf8")).toBe(old);
});
