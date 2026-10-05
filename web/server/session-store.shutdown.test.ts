import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "shutdown-store-"));
  roots.push(root);
  return { root, store: new SessionStore(root) };
}
function session(id: string): PersistedSession {
  return {
    id,
    state: { session_id: id } as PersistedSession["state"],
    messageHistory: [],
    pendingMessages: ['{"type":"user","message":{"content":"accepted input"}}'],
    pendingPermissions: [],
  };
}
it("preserves accepted pending input and the newest launcher identity before shutdown", async () => {
  const { root, store } = await setup();
  store.save(session("pending"));
  store.saveLauncher([{ cliSessionId: "older" }]);
  store.saveLauncher([{ cliSessionId: "original-thread" }]);
  await store.flushAll();
  expect((await store.load("pending"))?.pendingMessages).toEqual(session("pending").pendingMessages);
  expect(JSON.parse(await readFile(join(root, "launcher.json"), "utf8"))).toEqual([
    { cliSessionId: "original-thread" },
  ]);
});
it("rejects the shutdown barrier on a failed hot-state write and allows a successful replacement", async () => {
  // A directory at the isolated file target gives a deterministic write failure without permission assumptions.
  const { root, store } = await setup();
  await mkdir(join(root, "pending.json"));
  expect(await store.saveSync(session("pending"))).toBe(false);
  await expect(store.flushAll()).rejects.toThrow("Unsaved session state");
  await rm(join(root, "pending.json"), { recursive: true });
  store.save(session("pending"));
  await expect(store.flushAll()).resolves.toBeUndefined();
});
it("retains launcher write failures after their promises have settled", async () => {
  const { root, store } = await setup();
  await mkdir(join(root, "launcher.json"));
  store.saveLauncher([{ cliSessionId: "keep-thread" }]);
  await expect(store.flushAll()).rejects.toThrow("launcher");
});
it("does not certify a missing frozen segment merely because its hot file saved", async () => {
  const { root, store } = await setup();
  await mkdir(join(root, "pending.history.jsonl"));
  const value = session("pending");
  value.messageHistory = [
    { type: "result", data: { type: "result", subtype: "success" } },
  ] as PersistedSession["messageHistory"];
  store.saveSync(value);
  await expect(store.flushAll()).rejects.toThrow("frozen:pending");
});
