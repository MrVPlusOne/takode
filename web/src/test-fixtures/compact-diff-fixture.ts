import { createTwoFilesPatch, structuredPatch } from "diff";
import { projectQuestDelivery, type QuestCodeDelivery } from "../../shared/quest-delivery.js";
import type { QuestDeliveryClient } from "../components/QuestCommitChip.js";
import { DELIVERY_FIXTURE_QUEST } from "./commit-delivery-fixture.js";

export type CompactDiffFixtureState = "loaded" | "loading" | "error" | "unavailable";

const sourceFiles = [
  {
    path: "src/message-history.ts",
    status: "M",
    oldText:
      "export function appendMessage(\n  history: readonly Message[],\n  incoming: Message,\n): readonly Message[] {\n  const next = [...history];\n  next.push(incoming);\n  return next;\n}\n\nexport function readWindow(\n  history: readonly Message[],\n  cursor: string | undefined,\n  limit: number,\n): MessageWindow {\n  const end = findCursorIndex(history, cursor);\n  const start = end - limit;\n  const messages = history.slice(start, end);\n\n  return {\n    messages,\n    hasEarlier: true,\n    lastMessageId: messages.at(-1)?.id,\n  };\n}\n\nfunction findCursorIndex(\n  history: readonly Message[],\n  cursor: string | undefined,\n): number {\n  if (!cursor) return history.length;\n  const index = history.findIndex((message) => message.id === cursor);\n  return index;\n}\n",
    newText:
      "export function appendMessage(\n  history: readonly Message[],\n  incoming: Message,\n): readonly Message[] {\n  const existingIndex = history.findIndex((message) => message.id === incoming.id && message.channel === incoming.channel);\n\n  if (existingIndex === -1) {\n    return [...history, incoming];\n  }\n\n  const existing = history[existingIndex];\n  if (existing.revision >= incoming.revision) {\n    return history;\n  }\n\n  return history.map((message, index) =>\n    index === existingIndex ? incoming : message,\n  );\n}\n\nexport function readWindow(\n  history: readonly Message[],\n  cursor: string | undefined,\n  limit: number,\n): MessageWindow {\n  const end = findCursorIndex(history, cursor);\n  const start = Math.max(0, end - limit);\n  const messages = history.slice(start, end);\n\n  return {\n    messages,\n    hasEarlier: start > 0,\n    firstMessageId: messages[0]?.id,\n    lastMessageId: messages.at(-1)?.id,\n  };\n}\n\nfunction findCursorIndex(\n  history: readonly Message[],\n  cursor: string | undefined,\n): number {\n  if (!cursor) return history.length;\n  const index = history.findIndex((message) => message.id === cursor);\n  return index === -1 ? history.length : index;\n}\n",
  },
  {
    path: "src/message-history.test.ts",
    status: "M",
    oldText: 'describe("appendMessage", () => {\n});\n',
    newText:
      'describe("appendMessage", () => {\n  it("keeps the original list for a repeated revision", () => {\n    const message = createMessage({ id: "m-1", revision: 2 });\n    const history = [message];\n    expect(appendMessage(history, message)).toBe(history);\n  });\n\n  it("replaces a message with its newer revision", () => {\n    const before = createMessage({ id: "m-1", revision: 1 });\n    const after = { ...before, revision: 2, text: "Updated" };\n    expect(appendMessage([before], after)).toEqual([after]);\n  });\n});\n',
  },
];
const fileStats = sourceFiles.map(({ path, oldText, newText }) => {
  const lines = structuredPatch(path, path, oldText, newText).hunks.flatMap((hunk) => hunk.lines);
  return {
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
  };
});
const total = {
  additions: fileStats.reduce((sum, file) => sum + file.additions, 0),
  deletions: fileStats.reduce((sum, file) => sum + file.deletions, 0),
};
const diff = sourceFiles
  .map(
    ({ path, oldText, newText }) =>
      `diff --git a/${path} b/${path}\n${createTwoFilesPatch(`a/${path}`, `b/${path}`, oldText, newText)}`,
  )
  .join("\n");

export const compactDiffDeliveryFixture: QuestCodeDelivery = {
  id: "d".repeat(32),
  actorSessionId: "fixture-worker",
  phaseOccurrenceId: "fixture-work",
  recordedAt: 1_789_000_001_000,
  targetHeadSha: "7".repeat(40),
  target: { repoRoot: "/fixture/repo", checkoutPath: "/fixture/repo", branch: "integration", mode: "remote-backed" },
  commits: [
    {
      sha: "6".repeat(40),
      shortSha: "6".repeat(7),
      message: "Keep message history stable during updates",
      timestamp: 1_789_000_000_000,
      ...total,
      binaryFiles: 0,
      comparison: { method: "first-parent-v1", baseSha: "0".repeat(40), parentCount: 1 },
      review: {
        ref: "refs/takode/review/fixture/0",
        baseSha: "0".repeat(40),
        tipSha: "8".repeat(40),
        commitShas: ["8".repeat(40)],
      },
    },
    {
      sha: "7".repeat(40),
      shortSha: "7".repeat(7),
      message: "Update the binary preview asset",
      timestamp: 1_789_000_001_000,
      additions: 0,
      deletions: 0,
      binaryFiles: 1,
      comparison: { method: "first-parent-v1", baseSha: "6".repeat(40), parentCount: 1 },
    },
  ],
};

/** Exercise the real viewer with source-backed files, exact fixture evidence, and controlled lookup states. */
export function createCompactDiffFixtureClient(state: CompactDiffFixtureState): QuestDeliveryClient {
  return {
    async delivery(questId, deliveryId) {
      if (questId !== DELIVERY_FIXTURE_QUEST || deliveryId !== compactDiffDeliveryFixture.id)
        throw new Error("Unknown fixture delivery.");
      return projectQuestDelivery(questId, compactDiffDeliveryFixture);
    },
    async commit(_questId, _deliveryId, sha, review, includeDiff) {
      const metadata =
        review && sha === "8".repeat(40)
          ? {
              ...compactDiffDeliveryFixture.commits[0]!,
              sha,
              shortSha: sha.slice(0, 7),
              message: "Original history review",
            }
          : compactDiffDeliveryFixture.commits.find((commit) => commit.sha === sha);
      if (!metadata) throw new Error("Commit is outside this fixture delivery.");
      if (!includeDiff) return { ...metadata, available: true };
      if (state === "loading") return new Promise(() => {});
      if (state === "error") throw new Error("Fixture diff lookup failed.");
      if (state === "unavailable") return { sha, available: false, reason: "commit_not_available" };
      const binary = sha === "7".repeat(40);
      return {
        ...metadata,
        available: true,
        diff: binary ? "" : diff,
        sourceFiles: binary ? [] : sourceFiles,
        splitStats: binary ? undefined : { code: fileStats[0]!, tests: fileStats[1]! },
      };
    },
    async review() {
      return { snapshots: [{ index: 0, count: 1, label: "Original review" }], commitShas: ["8".repeat(40)] };
    },
  };
}
