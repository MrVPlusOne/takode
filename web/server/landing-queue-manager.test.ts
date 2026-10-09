import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingQueueManager } from "./landing-queue-manager.js";
import { LandingGateStore } from "./landing-gate-store.js";
import { LandingQueueStore } from "./landing-queue-store.js";
import { ResourceLeaseManager } from "./resource-lease-manager.js";
import { ResourceLeaseStore } from "./resource-lease-store.js";
import type { LandingCommitMapping, LandingTarget } from "../shared/landing-queue.js";

const target: LandingTarget = { repo: "takode", branch: "jiayi" };
const LEASE = "port:takode:jiayi";
const sha = (n: number) => n.toString(16).padStart(40, "0");

describe("landing queue manager", () => {
  let directory: string;
  let leases: ResourceLeaseManager;
  let queue: LandingQueueManager;
  let now: number;
  const leaseMessages = vi.fn((_sessionId: string, _content: string) => "sent" as const);
  const notify = vi.fn((_sessionId: string, _text: string) => undefined);

  beforeEach(async () => {
    // Real lease and queue stores in a disposable directory; only message delivery is faked.
    directory = mkdtempSync(join(tmpdir(), "landing-queue-"));
    now = Date.parse("2026-10-08T12:00:00Z");
    leaseMessages.mockClear();
    notify.mockClear();
    leases = new ResourceLeaseManager(
      { injectUserMessage: leaseMessages, invalidateSessionNavigation: vi.fn() },
      new ResourceLeaseStore("test", directory),
    );
    queue = new LandingQueueManager(
      {
        leases,
        notify,
        sessionNum: (id) => ({ a: 1, b: 2, c: 3 })[id],
        machineName: (hostId) => hostId ?? "laptop",
        now: () => now,
      },
      new LandingQueueStore("test", directory),
      new LandingGateStore("test", join(directory, "gates")),
    );
    // The target opted into the queue by having a saved gate.
    await queue.gates.set(target, { version: 1, steps: [{ name: "check", run: ["true"] }] }, { sessionId: "a" });
  });

  afterEach(() => {
    queue.destroy();
    leases.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  const submit = (session: string, n: number, extra: { preparationId?: string } = {}) =>
    queue.submit({
      callerSessionId: session,
      target,
      questId: `q-${n}`,
      bundleId: `b-0000000${n}`,
      base: sha(1),
      tip: sha(100 + n),
      commits: [{ sha: sha(100 + n), subject: `change ${n}` }],
      preSubmitTest: { kind: "skipped", reason: "test" },
      ...extra,
    });
  const mapping = (n: number): LandingCommitMapping[] => [
    { source: sha(100 + n), target: sha(200 + n), subject: `change ${n}` },
  ];

  it("lands every waiting entry in one run and only promotes owners whose entries still wait", async () => {
    // a submits first and holds the lease; b and c queue behind it. One run
    // started by a lands all three, so b and c are never promoted for nothing.
    const first = await submit("a", 1);
    expect(first.lease).toBe("acquired");
    expect((await submit("b", 2)).lease).toBe("queued");
    expect((await submit("c", 3)).position).toBe(2);

    const claim = await queue.claim("a", target);
    expect(claim.entries.map((entry) => entry.sessionId)).toEqual(["a", "b", "c"]);
    expect(queue.isLandingActive("b")).toBe(true);

    const run = claim.run!;
    await queue.recordPlan(run.id, "a", {
      base: sha(1),
      tip: sha(203),
      mapping: Object.fromEntries(claim.entries.map((entry, i) => [entry.id, mapping(i + 1)])),
    });
    await queue.finish(run.id, "a", {
      outcomes: claim.entries.map((entry, i) => ({ entryId: entry.id, outcome: "landed", mapping: mapping(i + 1) })),
      pushedTip: sha(203),
      summary: "Landed 3 of 3.",
    });

    const status = await leases.getStatus(LEASE);
    expect(status.leases).toEqual([]);
    expect(status.waiters).toEqual([]);
    expect(leaseMessages).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls[1]![1]).toContain(`Target SHAs in order: ${sha(202)}`);
    expect(notify.mock.calls[1]![1]).toContain("takode land finish q-2");
    expect(queue.isLandingActive("b")).toBe(false);
  });

  it("keeps only the latest outcome's reason and details on an entry", async () => {
    // An entry re-queued after a failed attempt must not show that old reason
    // once it lands, and a later bounce must not keep an earlier bounce's output.
    await submit("a", 1);
    const first = await queue.claim("a", target);
    await queue.finish(first.run!.id, "a", {
      outcomes: [{ entryId: first.entries[0]!.id, outcome: "requeue", reason: "Dependency install failed." }],
      summary: "Landed 0 of 1.",
    });
    expect((await queue.latestEntryFor("a"))!.reason).toBe("Dependency install failed.");
    const second = await queue.claim("a", target);
    await queue.finish(second.run!.id, "a", {
      outcomes: [{ entryId: second.entries[0]!.id, outcome: "landed", mapping: mapping(1) }],
      pushedTip: sha(201),
      summary: "Landed 1 of 1.",
    });
    const landed = (await queue.latestEntryFor("a"))!;
    expect(landed.state).toBe("landed");
    expect(landed.reason).toBeUndefined();

    await submit("b", 2);
    const third = await queue.claim("b", target);
    await queue.finish(third.run!.id, "b", {
      outcomes: [{ entryId: third.entries[0]!.id, outcome: "requeue", reason: "The push was rejected." }],
      summary: "Landed 0 of 1.",
    });
    const fourth = await queue.claim("b", target);
    await queue.finish(fourth.run!.id, "b", {
      outcomes: [{ entryId: fourth.entries[0]!.id, outcome: "bounced", reason: "It conflicts." }],
      summary: "Landed 0 of 1.",
    });
    const bounced = (await queue.latestEntryFor("b"))!;
    expect(bounced.reason).toBe("It conflicts.");
    expect(bounced.details).toBeUndefined();
  });

  it("bounces one entry, re-queues another and hands the lease to the next waiting owner", async () => {
    await submit("a", 1);
    await submit("b", 2);
    const claim = await queue.claim("a", target);
    await submit("c", 3); // arrives during the run
    await queue.finish(claim.run!.id, "a", {
      outcomes: [
        { entryId: claim.entries[0]!.id, outcome: "requeue", reason: "The push was rejected." },
        { entryId: claim.entries[1]!.id, outcome: "bounced", reason: "The landing gate failed.", details: "boom" },
      ],
      summary: "Landed 0 of 2.",
    });
    // b's waiter was withdrawn with its bounce; c (waiting since the run) is promoted
    // and told to run the queue; a is back in line behind c.
    const status = await leases.getStatus(LEASE);
    expect(status.leases.map((lease) => lease.ownerSessionId)).toEqual(["c"]);
    expect(status.waiters.map((waiter) => waiter.waiterSessionId)).toEqual(["a"]);
    expect(leaseMessages.mock.calls.at(-1)![1]).toContain("takode land run");
    const bounced = notify.mock.calls.find(([session]) => session === "b")![1];
    expect(bounced).toContain("bounced");
    expect(bounced).toContain("boom");
    expect(notify.mock.calls.find(([session]) => session === "a")![1]).toContain("waiting again");
    expect((await queue.claim("c", target)).entries.map((entry) => entry.sessionId)).toEqual(["a", "c"]);
  });

  it("requires the port lease to claim and releases it when nothing waits", async () => {
    await submit("a", 1);
    await submit("b", 2);
    await expect(queue.claim("b", target)).rejects.toThrow(`Hold ${LEASE}`);
    const entryId = (await queue.latestEntryFor("a"))!.id;
    await queue.withdraw(entryId, "a", () => false);
    // a still holds the lease but b's entry waits, so a can run it for b.
    expect((await queue.claim("a", target)).entries.map((entry) => entry.sessionId)).toEqual(["b"]);
  });

  it("abandons a run whose lander lost the lease and reconciles a recorded push plan", async () => {
    await submit("a", 1);
    await submit("b", 2);
    const claim = await queue.claim("a", target);
    await queue.recordPlan(claim.run!.id, "a", {
      base: sha(1),
      tip: sha(202),
      mapping: { [claim.entries[0]!.id]: mapping(1), [claim.entries[1]!.id]: mapping(2) },
    });
    // A leader force-releases the lease of a lander that died after recording its plan.
    await leases.release(LEASE, "leader", true);
    await queue.sweep();
    const snapshot = await queue.snapshot(target);
    expect(snapshot.activeRun).toBeUndefined();
    expect(snapshot.unreconciled.map((run) => run.id)).toEqual([claim.run!.id]);
    // b was waiting and is promoted; its claim must reconcile first.
    expect((await leases.getStatus(LEASE)).leases[0]!.ownerSessionId).toBe("b");
    const next = await queue.claim("b", target);
    expect(next.run).toBeUndefined();
    expect(next.unreconciled).toHaveLength(1);
    await queue.reconcile(claim.run!.id, "b", true);
    const entries = (await queue.snapshot(target)).entries;
    expect(entries.map((entry) => entry.state)).toEqual(["landed", "landed"]);
    expect(entries[1]!.mapping).toEqual(mapping(2));
  });

  it("returns an abandoned run without a push plan to the queue", async () => {
    await submit("a", 1);
    const claim = await queue.claim("a", target);
    await leases.release(LEASE, "a");
    await queue.sweep();
    // a lost the lease without pushing; it is queued again and promoted at once.
    expect((await queue.snapshot(target)).entries[0]!.state).toBe("pending");
    expect((await leases.getStatus(LEASE)).leases[0]!.ownerSessionId).toBe("a");
    expect((await queue.claim("a", target)).entries[0]!.id).toBe(claim.entries[0]!.id);
  });

  it("attests landings and bounced preparations only for the owning session", async () => {
    const prep = "a".repeat(32);
    await submit("a", 1, { preparationId: prep });
    const claim = await queue.claim("a", target);
    const entryId = claim.entries[0]!.id;
    expect(await queue.attestsUnlanded(prep, "a")).toBe(false);
    await queue.finish(claim.run!.id, "a", {
      outcomes: [{ entryId, outcome: "landed", mapping: mapping(1) }],
      summary: "Landed 1 of 1.",
    });
    expect(await queue.attestsLanding(entryId, "a", prep, sha(101), sha(201))).toBe(true);
    expect(await queue.attestsLanding(entryId, "b", prep, sha(101), sha(201))).toBe(false);
    expect(await queue.attestsLanding(entryId, "a", prep, sha(101), sha(299))).toBe(false);

    const other = "b".repeat(32);
    await submit("b", 2, { preparationId: other });
    const second = await queue.claim("b", target);
    await queue.finish(second.run!.id, "b", {
      outcomes: [{ entryId: second.entries[0]!.id, outcome: "bounced", reason: "conflict" }],
      summary: "Landed 0 of 1.",
    });
    expect(await queue.attestsUnlanded(other, "b")).toBe(true);
    expect(await queue.attestsUnlanded(other, "a")).toBe(false);
  });

  it("allows one waiting entry per session and lets only its owner or leader withdraw it", async () => {
    const { entry } = await submit("a", 1);
    await expect(submit("a", 2)).rejects.toThrow("still pending");
    await expect(queue.withdraw(entry.id, "b", () => false)).rejects.toThrow("owner or its leader");
    const withdrawn = await queue.withdraw(entry.id, "leader", (owner) => owner === "a");
    expect(withdrawn.reason).toContain("leader");
    expect((await submit("a", 2)).entry.state).toBe("pending");
  });

  it("only queues targets with a saved gate", async () => {
    // Opting in is decided by the gate saved on the server, not by anything in the repository.
    await queue.gates.remove(target);
    await expect(submit("a", 1)).rejects.toThrow("No landing gate is saved for takode:jiayi");
    expect((await leases.getStatus(LEASE)).leases).toEqual([]);
    await queue.gates.set(target, { version: 1, steps: [{ name: "check", run: ["true"] }] }, {});
    expect((await submit("a", 1)).entry.state).toBe("pending");
  });

  it("stops counting a run as progressing once its heartbeat is stale", async () => {
    await submit("a", 1);
    const claim = await queue.claim("a", target);
    expect(queue.isLandingActive("a")).toBe(true);
    now += 6 * 60_000;
    expect(queue.isLandingActive("a")).toBe(false);
    await queue.heartbeat(claim.run!.id, "a", "gating 1 change(s)");
    expect(queue.isLandingActive("a")).toBe(true);
  });
});
