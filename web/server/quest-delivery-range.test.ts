import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQuest } from "./quest-store.js";
import { readCommitSummary } from "./git-commit-reader.js";
import { readDeliveryRange, resolveDeliveryRange } from "./quest-delivery-range.js";
import { registerQuestDeliveryRoutes } from "./routes/quest-deliveries.js";
import { runCommitLinksCommand } from "../bin/quest-commit-links.js";
import { parseQuestLinkTarget } from "../src/utils/quest-link-target.js";
import type { CommitRange, QuestCodeDelivery } from "../shared/quest-delivery.js";

vi.mock("./quest-store.js", () => ({ getQuest: vi.fn() }));

let root: string;
let delivery: QuestCodeDelivery;
let range: CommitRange;
let members: string[];
let quest: { commitShas: string[]; codeDeliveries: QuestCodeDelivery[] };
const questId = "q-9907";
const prefix = `/quests/${questId}/deliveries/${"d".repeat(32)}`;
const git = (...args: string[]) =>
  execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8" }).trim();

function commit(message: string, parents: string[] = []): string {
  writeFileSync(join(root, "feature.txt"), `${message}\n`);
  git("add", "feature.txt");
  return git("commit-tree", git("write-tree"), ...parents.flatMap((sha) => ["-p", sha]), "-m", message);
}

beforeEach(async () => {
  // Every object, ref, shallow boundary, and cleanup stays in a uniquely owned disposable repo.
  root = mkdtempSync(join(tmpdir(), "delivery-range-test-"));
  git("init", "-q");
  git("config", "user.name", "Range test");
  git("config", "user.email", "range@example.test");
  const base = commit("Before feature");
  const implementation = commit("Main implementation", [base]);
  const reconciliation = commit("Reconcile existing test", [implementation]);
  const tip = commit("Compatibility correction", [reconciliation]);
  members = [implementation, reconciliation, tip];
  range = { baseSha: base, tipSha: tip };
  delivery = {
    id: "d".repeat(32),
    recordedAt: 1,
    actorSessionId: "fixture-worker",
    phaseOccurrenceId: "fixture-work",
    target: { repoRoot: root, checkoutPath: root, branch: "published", mode: "published" },
    targetHeadSha: tip,
    commits: [{ ...(await readCommitSummary(root, tip)), additions: 99, comparison: undefined }],
  };
  quest = { commitShas: [tip], codeDeliveries: [delivery] };
  vi.mocked(getQuest).mockResolvedValue(quest as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("read-only delivery range browsing", () => {
  it("authors native links for all three real commits and serves matching per-commit patches without rewriting the head-only record", async () => {
    const saved = JSON.stringify(quest);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommitLinksCommand({
      questId,
      deliveryId: delivery.id,
      range: `${range.baseSha}..${range.tipSha}`,
      json: true,
    });
    const authored = JSON.parse(output.mock.calls[0]![0] as string);
    expect(authored.commits.map((entry: { sha: string }) => entry.sha)).toEqual(members);
    expect(authored.range).toEqual(range);
    expect(JSON.stringify(authored)).not.toContain(root);
    const app = new Hono();
    registerQuestDeliveryRoutes(app);
    const query = `base=${range.baseSha}&tip=${range.tipSha}`;
    const view = await (await app.request(`${prefix}?${query}`)).json();
    expect(view.commits.map((entry: { sha: string }) => entry.sha)).toEqual(members);
    for (const [index, sha] of members.entries()) {
      const href = authored.commits[index].markdown.match(/\]\(([^)]+)\)$/)[1];
      expect(parseQuestLinkTarget(href)).toEqual({ questId, delivery: { id: delivery.id, sha, range } });
      const details = await (await app.request(`${prefix}/commits/${sha}?${query}`)).json();
      expect(details).toMatchObject({
        sha,
        available: true,
        additions: 1,
        deletions: 1,
        comparison: { baseSha: index ? members[index - 1] : range.baseSha },
      });
      expect(details.diff).toContain(`+${view.commits[index].message}\n`);
      expect(details).not.toHaveProperty("recordedStats");
    }
    const original = await (await app.request(prefix)).json();
    expect(original.commits).toHaveLength(1);
    expect(original.commits[0].additions).toBe(99);
    expect(original).not.toHaveProperty("range");
    expect(JSON.stringify(quest)).toBe(saved);
    expect((await app.request(`${prefix}/commits/${members[0]}`)).status).toBe(404);
  });

  it("keeps fixed endpoints and rejects unrelated, corrected, incomplete, or outside-range evidence", async () => {
    const unrelated = commit("Unrelated root");
    await expect(resolveDeliveryRange(delivery, quest.commitShas, { ...range, baseSha: unrelated })).rejects.toThrow();
    await expect(resolveDeliveryRange(delivery, quest.commitShas, { ...range, tipSha: members[0]! })).rejects.toThrow(
      "authoritative",
    );
    await expect(resolveDeliveryRange(delivery, [], range)).rejects.toThrow("authoritative");
    await expect(
      resolveDeliveryRange(delivery, quest.commitShas, { baseSha: range.tipSha, tipSha: range.tipSha }),
    ).rejects.toThrow("non-empty");
    const app = new Hono();
    registerQuestDeliveryRoutes(app);
    const query = `base=${range.baseSha}&tip=${range.tipSha}`;
    expect((await app.request(`${prefix}/commits/${unrelated}?${query}`)).status).toBe(404);
    expect((await app.request(`${prefix}?base=${range.baseSha}`)).status).toBe(400);
    expect((await app.request(`${prefix}/commits/${members[0]}?${query}&review=true`)).status).toBe(400);
    const next = commit("Later delivery", [range.tipSha]);
    quest.commitShas.push(next);
    quest.codeDeliveries.push({ ...delivery, id: "e".repeat(32), commits: [await readCommitSummary(root, next)] });
    expect(
      (await readDeliveryRange(questId, delivery, quest.commitShas, range)).commits.map((item) => item.sha),
    ).toEqual(members);
    delivery.target.repoRoot = join(root, "missing-repository");
    expect((await app.request(`${prefix}?${query}`)).status).toBe(404);
    expect(await (await app.request(`${prefix}/commits/${members[0]}?${query}`)).json()).toMatchObject({
      available: false,
    });
  });

  it("includes merged ancestry and fails explicitly when a shallow side branch would silently omit history", async () => {
    // Base remains reachable through parent one, so an ancestry check alone cannot prove completeness.
    const sideParent = commit("Side parent", [range.baseSha]);
    const side = commit("Side change", [sideParent]);
    const merge = commit("Merge", [range.tipSha, side]);
    range.tipSha = merge;
    delivery.commits = [await readCommitSummary(root, merge)];
    quest.commitShas = [merge];
    const result = await readDeliveryRange(questId, delivery, quest.commitShas, range);
    expect(new Set(result.commits.map((item) => item.sha))).toEqual(new Set([...members, sideParent, side, merge]));
    expect(result.commits.at(-1)?.comparison).toMatchObject({ parentCount: 2, baseSha: members[2] });
    writeFileSync(join(root, ".git", "shallow"), `${side}\n`);
    await expect(resolveDeliveryRange(delivery, quest.commitShas, range)).rejects.toThrow("shallow boundary");
    // A shallow base also prevents proving which older side-branch ancestors should be excluded.
    writeFileSync(join(root, ".git", "shallow"), `${range.baseSha}\n`);
    await expect(resolveDeliveryRange(delivery, quest.commitShas, range)).rejects.toThrow("shallow boundary");
  });

  it("rejects oversized ranges instead of authoring a silently truncated selection", async () => {
    let tip = range.tipSha;
    const tree = git("write-tree");
    for (let index = 0; index < 198; index++) tip = git("commit-tree", tree, "-p", tip, "-m", `Increment ${index}`);
    range.tipSha = tip;
    delivery.commits = [await readCommitSummary(root, tip)];
    await expect(resolveDeliveryRange(delivery, [tip], range)).rejects.toThrow("exceeds 200");
  });
});
