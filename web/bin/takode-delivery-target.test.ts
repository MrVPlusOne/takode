import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleBoard } from "./takode-board.js";
import { handleRecordDelivery } from "./takode-record-delivery.js";
import { handleDeliveryTarget } from "./takode-delivery-target.js";
import { apiGet, apiPost } from "./takode-core.js";
import { deliveryFixture } from "../src/test-fixtures/commit-delivery-fixture.js";
import { projectQuestDelivery } from "../shared/quest-delivery.js";

vi.mock("./takode-core.js", async (original) => ({
  ...(await original<typeof import("./takode-core.js")>()),
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  err: (message: string) => {
    throw new Error(message);
  },
}));
let root: string;
const id = "c".repeat(32);
const sha = deliveryFixture.commits[0]!.sha;
beforeEach(() => {
  vi.clearAllMocks();
  // These leader and worker commands identify their caller; give them a session.
  vi.stubEnv("COMPANION_SESSION_ID", "session-1");
  vi.stubEnv("COMPANION_AUTH_TOKEN", "token-1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), "delivery-target-cli-test-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it("routes the leader command, reads exact target JSON and emits only operational approval metadata", async () => {
  // A bulky backend field must not leak through compact JSON, even on an uncommon command.
  const target = {
    checkoutPath: "/fixture/source",
    remote: "origin",
    repositoryUrl: "https://example.com/repo.git",
    refs: [{ ref: "refs/heads/user/change", sha }],
    commitShas: ["a".repeat(40), "b".repeat(40), sha],
  };
  const path = join(root, "target.json");
  writeFileSync(path, JSON.stringify(target));
  vi.mocked(apiPost).mockResolvedValue({
    approvals: [{ approvalId: id, refCount: 1, commitCount: 3 }],
    injectedSystemPrompt: "hidden".repeat(10000),
    target,
  });
  await handleBoard("http://fixture", ["approve-delivery-target", "q-1", "--target-file", path, "--json"]);
  expect(apiPost).toHaveBeenCalledWith("http://fixture", "/takode/board/approve-delivery-target", {
    questId: "q-1",
    target,
  });
  expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string)).toEqual({
    questId: "q-1",
    approvalId: id,
    refCount: 1,
    commitCount: 3,
  });
});

it("keeps list output compact and reveals persisted target detail only by explicit ID", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    approvals: [
      {
        id,
        approvedAt: 1,
        phaseOccurrenceId: "work-occurrence",
        refCount: 3,
        commitCount: 5,
        target: { checkoutPath: "/hidden/source" },
        injectedSystemPrompt: "hidden".repeat(10000),
      },
    ],
  });
  await handleDeliveryTarget("http://fixture", "delivery-targets", ["q-1", "--json"]);
  const compact = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
  expect(compact.approvals[0]).toEqual({
    id,
    approvedAt: 1,
    phaseOccurrenceId: "work-occurrence",
    refCount: 3,
    commitCount: 5,
  });
  vi.mocked(apiGet).mockResolvedValue({ approval: { id, target: { checkoutPath: "/explicit/source" } } });
  await handleDeliveryTarget("http://fixture", "delivery-targets", ["q-1", "--target", id, "--json"]);
  expect(apiGet).toHaveBeenLastCalledWith("http://fixture", `/takode/board/delivery-targets/q-1/${id}`);
  expect(JSON.parse(vi.mocked(console.log).mock.calls[1]![0] as string).approval.target.checkoutPath).toBe(
    "/explicit/source",
  );
});

it.each([
  "record-work-delivery",
  "work-to-memory",
])("passes target authority through %s without a raw override", async (action) => {
  vi.mocked(apiPost).mockResolvedValue({
    questId: "q-1",
    board: [],
    newState: "MEMORY",
    workFeedbackIndex: 0,
    deliveries: [projectQuestDelivery("q-1", deliveryFixture)],
  });
  await handleBoard("http://fixture", [action, "q-1", "--commits", sha, "--delivery-target", id, "--json"]);
  expect(apiPost).toHaveBeenCalledWith(
    "http://fixture",
    `/takode/board/${action}`,
    expect.objectContaining({ deliveryTargetIds: [id], commitShas: [sha] }),
  );
  // A single delivery keeps the single-repository JSON shape scripts already read.
  const output = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string);
  expect(output.delivery?.id ?? output.deliveryId).toBe(deliveryFixture.id);
  expect(output.deliveries).toBeUndefined();
});

it.each([
  ["a comma-separated list", ["--delivery-target", `${id},${"d".repeat(32)}`]],
  ["a repeated flag", ["--delivery-target", id, "--delivery-target", "d".repeat(32)]],
])("names several approvals with %s and lists each recorded delivery", async (_label, targetArgs) => {
  // Work spanning repositories: every approval must reach the server, not only the last flag value.
  const second = { ...deliveryFixture, id: "e".repeat(32) };
  vi.mocked(apiPost).mockResolvedValue({
    questId: "q-1",
    board: [],
    newState: "MEMORY",
    workFeedbackIndex: 0,
    deliveries: [projectQuestDelivery("q-1", deliveryFixture), projectQuestDelivery("q-1", second)],
  });
  await handleBoard("http://fixture", ["work-to-memory", "q-1", "--commits", sha, ...targetArgs, "--json"]);
  expect(apiPost).toHaveBeenCalledWith(
    "http://fixture",
    "/takode/board/work-to-memory",
    expect.objectContaining({ deliveryTargetIds: [id, "d".repeat(32)] }),
  );
  const output = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string);
  expect(output.deliveries.map((item: { id: string }) => item.id)).toEqual([deliveryFixture.id, second.id]);
});

it("sends a landing entry together with approved targets' commits", async () => {
  vi.mocked(apiPost).mockResolvedValue({
    questId: "q-1",
    board: [],
    newState: "MEMORY",
    workFeedbackIndex: 0,
    deliveries: [],
  });
  await handleBoard("http://fixture", [
    "work-to-memory",
    "q-1",
    "--landing-entry",
    "le-0000abcd",
    "--commits",
    sha,
    "--delivery-target",
    id,
    "--json",
  ]);
  expect(apiPost).toHaveBeenCalledWith(
    "http://fixture",
    "/takode/board/work-to-memory",
    expect.objectContaining({ landingEntryId: "le-0000abcd", commitShas: [sha], deliveryTargetIds: [id] }),
  );
});

it("approves a list of targets in one request and prints every approval", async () => {
  const targets = ["/fixture/code", "/fixture/skills"].map((checkoutPath) => ({
    checkoutPath,
    remote: "origin",
    repositoryUrl: `https://example.com${checkoutPath}.git`,
    refs: [{ ref: "refs/heads/main", sha }],
    commitShas: [sha],
  }));
  const path = join(root, "targets.json");
  writeFileSync(path, JSON.stringify(targets));
  const approvals = [id, "d".repeat(32)].map((approvalId) => ({ approvalId, refCount: 1, commitCount: 1 }));
  vi.mocked(apiPost).mockResolvedValue({ approvals });
  await handleBoard("http://fixture", ["approve-delivery-target", "q-1", "--target-file", path, "--json"]);
  expect(apiPost).toHaveBeenCalledWith("http://fixture", "/takode/board/approve-delivery-target", {
    questId: "q-1",
    targets,
  });
  expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string)).toEqual({ questId: "q-1", approvals });
});

it("rejects --no-code with a delivery target before a request", async () => {
  await expect(
    handleBoard("http://fixture", ["work-to-memory", "q-1", "--commits", sha, "--delivery-target", id, "--no-code"]),
  ).rejects.toThrow("cannot combine");
  expect(apiPost).not.toHaveBeenCalled();
});

it("rejects malformed IDs and raw target flags before a request", async () => {
  await expect(
    handleRecordDelivery("http://fixture", ["q-1", "--commits", sha, "--delivery-target", "bad"]),
  ).rejects.toThrow("exact leader-approved");
  await expect(
    handleRecordDelivery("http://fixture", ["q-1", "--commits", sha, "--target-file", "bad"]),
  ).rejects.toThrow();
  expect(apiPost).not.toHaveBeenCalled();
});
