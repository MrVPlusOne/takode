import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { QUEST_JOURNEY_PHASES } from "../shared/quest-journey.js";
import {
  ensureBuiltInQuestJourneyPhaseData,
  ensureQuestJourneyPhaseDataForCwd,
  getQuestJourneyPhaseAssigneeBriefPath,
  getQuestJourneyPhaseDataRoot,
  getQuestJourneyPhaseDisplayRoot,
  getQuestJourneyPhaseLeaderBriefPath,
  loadBuiltInQuestJourneyPhases,
  loadQuestJourneyPhaseCatalog,
} from "./quest-journey-phases.js";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SERVER_DIR, "..");
const tmpHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tmpHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeCompanionHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quest-journey-phases-"));
  tmpHomes.push(dir);
  return dir;
}

describe("Quest Journey v2 phase directory loading", () => {
  it("seeds only active v2 phase directories from canonical repo data", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });

    expect(phases.map((phase) => phase.id)).toEqual(QUEST_JOURNEY_PHASES.map((phase) => phase.id));
    expect(phases.map((phase) => phase.id)).toEqual(["alignment", "work", "user-checkpoint", "memory"]);
    expect(getQuestJourneyPhaseDisplayRoot()).toBe("~/.companion/quest-journey-phases");

    for (const phase of phases) {
      expect(phase.dirPath).toBe(join(getQuestJourneyPhaseDataRoot({ companionHome }), phase.id));
      expect(phase.phaseJsonPath).toBe(join(phase.dirPath, "phase.json"));
      expect(phase.leaderBriefPath).toBe(getQuestJourneyPhaseLeaderBriefPath(phase.id, { companionHome }));
      expect(phase.assigneeBriefPath).toBe(getQuestJourneyPhaseAssigneeBriefPath(phase.id, { companionHome }));
      expect(phase.leaderBrief).toContain("Leader Brief");
      expect(phase.assigneeBrief).toContain("Assignee Brief");
      expect(phase.contract.length).toBeGreaterThan(20);
      expect(phase.nextLeaderAction.length).toBeGreaterThan(20);
    }
  });

  it("refreshes active phase files from canonical repo data on reseed", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const workPath = getQuestJourneyPhaseLeaderBriefPath("work", { companionHome });
    await writeFile(workPath, "stale", "utf-8");

    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const refreshed = await readFile(workPath, "utf-8");
    const canonical = await readFile(
      join(PACKAGE_ROOT, "shared", "quest-journey-phases", "work", "leader.md"),
      "utf-8",
    );
    expect(refreshed).toBe(canonical);
  });

  it("removes obsolete live v1 phase directories while preserving active v2 directories", async () => {
    const companionHome = await makeCompanionHome();
    const dataRoot = getQuestJourneyPhaseDataRoot({ companionHome });
    for (const legacy of ["planning", "implement", "code-review", "execute", "port", "bookkeeping"]) {
      await mkdir(join(dataRoot, legacy), { recursive: true });
      await writeFile(join(dataRoot, legacy, "assignee.md"), "stale legacy brief", "utf-8");
    }

    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    for (const legacy of ["planning", "implement", "code-review", "execute", "port", "bookkeeping"]) {
      await expect(readFile(join(dataRoot, legacy, "assignee.md"), "utf-8")).rejects.toThrow();
    }
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("alignment", { companionHome }), "utf-8"),
    ).resolves.toContain("Alignment -- Assignee Brief");
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("work", { companionHome }), "utf-8"),
    ).resolves.toContain("Work -- Assignee Brief");
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("memory", { companionHome }), "utf-8"),
    ).resolves.toContain("Memory -- Assignee Brief");
  });

  it("refreshes runtime phase files from the package root nearest the session cwd", async () => {
    const companionHome = await makeCompanionHome();
    const repoRoot = await mkdtemp(join(tmpdir(), "quest-journey-worktree-"));
    tmpHomes.push(repoRoot);
    const packageRoot = join(repoRoot, "web");
    const phaseRoot = join(packageRoot, "shared", "quest-journey-phases");
    await cp(join(PACKAGE_ROOT, "shared", "quest-journey-phases"), phaseRoot, { recursive: true });
    const workPhaseDir = join(packageRoot, "shared", "quest-journey-phases", "work");
    await mkdir(workPhaseDir, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{}", "utf-8");
    await writeFile(
      join(workPhaseDir, "phase.json"),
      JSON.stringify({
        id: "work",
        label: "Work",
        color: { name: "green", accent: "#4ade80" },
        boardState: "WORKING",
        assigneeRole: "worker",
        contract: "Fresh from worktree cwd for v2 Work.",
        nextLeaderAction: "fresh next action from worktree cwd",
        aliases: [],
      }),
      "utf-8",
    );
    await writeFile(join(workPhaseDir, "leader.md"), "# Work -- Leader Brief\n\nFresh from worktree cwd", "utf-8");
    await writeFile(join(workPhaseDir, "assignee.md"), "# Work -- Assignee Brief\n\nFresh from worktree cwd", "utf-8");

    const refreshed = await ensureQuestJourneyPhaseDataForCwd(join(repoRoot, "nested", "session"), { companionHome });

    expect(refreshed).toBe(true);
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("work", { companionHome }), "utf-8"),
    ).resolves.toContain("Fresh from worktree cwd");
  });

  it("seeds active v2 phase briefs with the key ownership contracts", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const lifecycle = await readFile(
      resolve(PACKAGE_ROOT, "..", ".claude", "skills", "takode-orchestration", "quest-journey.md"),
      "utf-8",
    );
    const alignment = phases.find((phase) => phase.id === "alignment")!;
    const work = phases.find((phase) => phase.id === "work")!;
    const checkpoint = phases.find((phase) => phase.id === "user-checkpoint")!;
    const memory = phases.find((phase) => phase.id === "memory")!;

    expect(alignment.assigneeBrief).toContain("leader-verification packet, not a planning report");
    expect(alignment.assigneeBrief).toContain("minimal understanding and authorization handshake");
    expect(alignment.assigneeBrief).toContain("not implementation investigation");
    expect(alignment.assigneeBrief).toContain("A completed Alignment is not a user-input wait");
    expect(alignment.assigneeBrief).toContain("Do **not** call `takode notify needs-input`");
    // Protect the generic evidence threshold without encoding the rejected incident-specific scenario.
    expect(alignment.assigneeBrief).toContain("protected access method alone");
    expect(alignment.assigneeBrief).toContain("concrete payload evidence");
    expect(alignment.assigneeBrief).toContain("The ordinary `turn_end` event is the leader approval signal");
    expect(alignment.leaderBrief).toContain("Do not convert the Alignment note into a Work prompt");
    expect(alignment.leaderBrief).toContain("leader-owned decision or Journey revision");
    expect(work.assigneeBrief).toContain("worker-owned Work -> Memory transition");
    expect(work.assigneeBrief).toContain("Do not wait for the leader to restate the quest or prescribe an approach");
    expect(work.assigneeBrief).toContain("Communicate in coherent batches");
    expect(work.assigneeBrief).not.toContain("Recovery preserves the full remaining authorized Work envelope");
    expect(work.assigneeBrief).not.toContain("recovery pending");
    expect(work.assigneeBrief).toContain("concise plain-language outcome section");
    // Keep remediation bounded while preserving blocking treatment for material failures.
    expect(work.assigneeBrief).toContain("one focused autonomous remediation pass per root-cause issue class");
    expect(work.assigneeBrief).toContain("do not claim success or start another autonomous loop");
    expect(work.assigneeBrief).toContain(
      "Concrete evidence may justify a transformation but does not by itself authorize broader scope",
    );
    expect(work.assigneeBrief).toContain("Deliver cosmetic or non-material issues with a caveat");
    expect(work.assigneeBrief).toContain("A new validator or hard gate introduced mid-Work");
    expect(work.assigneeBrief).toContain("Do not call Work complete or hand off to Memory");
    expect(work.assigneeBrief).toContain("return the compact Work handoff and stop the Work turn");
    expect(work.assigneeBrief).toContain("Do not begin final Memory in the same turn");
    expect(work.assigneeBrief).toContain("Supply exactly one fresh code-evidence mode");
    expect(work.assigneeBrief).toContain("synchronized selected-target SHAs");
    expect(work.assigneeBrief).toContain("`--no-code` only when the accepted Work produced zero git-tracked changes");
    expect(work.assigneeBrief).toContain("before the row enters `MEMORY`");
    expect(work.assigneeBrief).toContain("final Memory must not be the first phase to attach");
    expect(work.leaderBrief).toContain("separate quest with its own Alignment -> Work -> Memory flow");
    expect(work.leaderBrief).toContain("evidence alone does not authorize the broader scope");
    expect(work.leaderBrief).toContain("Normal non-transforming safeguards remain mandatory");
    expect(work.leaderBrief).toContain("one focused autonomous remediation pass per root-cause issue class");
    expect(work.leaderBrief).toContain("do not claim success or start another autonomous loop");
    expect(work.leaderBrief).toContain(
      "Alignment approval confirms the worker's understanding of the authorized scope and the intended Journey routing",
    );
    expect(work.leaderBrief).toContain(
      "by itself it does not promote worker findings, leader paraphrases, or proposed approaches into requirements",
    );
    expect(work.leaderBrief).toContain(
      "complete worker-context authority rule in the preloaded `leader-dispatch` skill",
    );
    expect(work.leaderBrief).toContain("short natural Work authorization is sufficient");
    expect(work.leaderBrief).not.toContain("Preserve source authority in every leader-authored worker context");
    expect(work.leaderBrief).not.toContain("Do not promote leader synthesis into accepted scope");
    expect(work.leaderBrief).not.toContain("--author human");
    expect(work.leaderBrief).not.toContain("Leader-only deltas");
    expect(work.leaderBrief).toContain("authoritative source for recovery routing inside an active Work occurrence");
    expect(work.leaderBrief).toContain("Recovery preserves the full remaining authorized Work envelope");
    expect(work.leaderBrief).toContain("allow one short verification window");
    expect(work.leaderBrief).toContain("interrupt the stale turn");
    expect(work.leaderBrief).toContain("exact-once replay proof or recovery suppression");
    expect(work.leaderBrief).toContain("Treat a handoff with uncommitted changes");
    expect(work.leaderBrief).toContain("authoritative design-to-implementation continuity rule");
    expect(work.leaderBrief).toContain("reconcile the current quest metadata before returning it to Work");
    expect(work.leaderBrief).toContain("revise the title when it still reads as design-only");
    expect(work.leaderBrief).toContain("Do not defer this correction to final Memory");
    expect(work.leaderBrief).toContain("before telling the user a feature is implemented, available, or ready to test");
    expect(work.leaderBrief).toContain("When accepted scope still includes implementation");
    expect(work.leaderBrief).toContain("promptly report the main accepted answer, finding, or outcome");
    expect(work.leaderBrief).toContain("normally carries the substantive `:A:<ids>` answer");
    expect(work.leaderBrief).toContain("canonical answer-quality rule in `takode-orchestration`");
    expect(work.leaderBrief).toContain("do not describe the still-open quest as technically complete");
    expect(work.leaderBrief).toContain("The user-facing thread may be Ready");
    expect(work.leaderBrief).toContain("Every transition must supply exactly one fresh evidence mode");
    expect(work.leaderBrief).toContain("old quest commit list does not replace fresh transition evidence");
    expect(work.leaderBrief).toContain("must not patch tracked implementation files or first-attach Work code SHAs");
    expect(work.assigneeBrief).toContain('--skip-optional-checkpoint "<reason>"');
    expect(work.assigneeBrief).toContain(
      "Do not use generic `board advance` when that skip would land directly in Memory",
    );
    expect(work.leaderBrief).toContain("approved optional suffix `[work, user-checkpoint, memory]`");
    expect(work.leaderBrief).toContain("Required checkpoints and optional checkpoints that are actually taken");
    expect(work.contract).toContain("attach synchronized target code commits or explicit zero-code evidence");
    expect(work.nextLeaderAction).toContain("tracked Work commits already attached as structured metadata");
    expect(work.nextLeaderAction).toContain("promptly report the accepted outcome");
    expect(work.leaderBrief).not.toContain("Give the worker the exact approved scope");
    expect(checkpoint.leaderBrief).toContain("return the current quest to its assigned worker in `WORKING`");
    expect(checkpoint.leaderBrief).toContain(
      "same-quest implementation, design-only closure, or a separate implementation successor",
    );
    expect(checkpoint.leaderBrief).toContain("only when the answer requires it");
    expect(checkpoint.leaderBrief).toContain(
      "reconcile the current quest metadata before clearing the wait or resuming Work",
    );
    expect(checkpoint.leaderBrief).toContain("revise the title when it still reads as design-only");
    expect(checkpoint.leaderBrief).toContain(
      "update the description and TLDR when they no longer cover the full approved design-and-build scope",
    );
    expect(checkpoint.leaderBrief).toContain("Do not defer this correction to final Memory");
    expect(checkpoint.nextLeaderAction).toContain("before checkpoint entry verify or revise");
    expect(checkpoint.nextLeaderAction).toContain("advance or resume the assigned worker into that later Work");
    expect(checkpoint.nextLeaderAction).toContain("never route a taken checkpoint directly to Memory");
    expect(checkpoint.leaderBrief).toContain("`leader-decision-communication` skill");
    expect(checkpoint.leaderBrief).toContain("supporting technical evidence in the phase note");
    expect(checkpoint.leaderBrief).toContain("visible decision section before calling `takode notify`");
    expect(checkpoint.assigneeBrief).toContain("`leader-decision-communication` skill");
    expect(checkpoint.assigneeBrief).toContain("complete technical or safety packet in phase documentation");
    expect(checkpoint.assigneeBrief).toContain(
      "same-quest implementation, design-only closure, or a separate implementation successor",
    );
    expect(checkpoint.leaderBrief).toContain("Same-quest routing continues implementation");
    expect(checkpoint.leaderBrief).toContain("design-only or successor routing closes the current accepted scope");
    expect(checkpoint.assigneeBrief).toContain("before current-quest closure");
    expect(checkpoint.assigneeBrief).toContain("must resume into a later Work occurrence before Memory");
    expect(checkpoint.assigneeBrief).toContain('work-to-memory ... --skip-optional-checkpoint "<reason>"');
    expect(checkpoint.leaderBrief).toContain("revise the remaining Journey to `[user-checkpoint, work, memory]`");
    expect(checkpoint.leaderBrief).toContain("Generic `board advance --skip-optional-checkpoint` must not be used");
    expect(checkpoint.contract).toContain("continue into a later Work occurrence before Memory");
    expect(checkpoint.leaderBrief).not.toContain("For Execute or other externally consequential phases");
    expect(checkpoint.assigneeBrief).not.toContain("gates Execute or another externally consequential phase");
    expect(memory.assigneeBrief).toContain("exactly one memory statement");
    expect(memory.assigneeBrief).toContain("plain-language user-facing outcome");
    expect(memory.assigneeBrief).toContain("do not paste the whole phase note into the final debrief");
    expect(memory.leaderBrief).toContain("Memory is asynchronous post-processing");
    expect(memory.leaderBrief).toContain("report it now from the current Work note");
    expect(memory.leaderBrief).toContain("ordinary read-only follow-up questions during Memory");
    expect(memory.leaderBrief).toContain("without reopening the quest");
    expect(memory.leaderBrief).toContain("Report routine Memory completion as routed commentary/status");
    expect(memory.leaderBrief).toContain("materially completes, corrects, or changes the prior response");
    expect(memory.nextLeaderAction).toContain("report the accepted outcome if it is not already visible");
    expect(memory.leaderBrief).toContain("normal same-worker Memory owner");
    expect(memory.leaderBrief).toContain("route the assigned Work worker back to Work");
    expect(memory.assigneeBrief).toContain("route the assigned worker back to Work");
    expect(memory.assigneeBrief).toContain("do not repair the gap by adding `--commit` / `--commits`");
    expect(memory.assigneeBrief).toContain("`--memory-commit` / `--memory-commits`");
    expect(memory.assigneeBrief).toContain("guarded Work -> Memory transition");
    expect(memory.assigneeBrief).toContain(
      "fresh git-state validation rather than an inspectable persisted no-code marker",
    );
    expect(memory.leaderBrief).toContain("do not ask Memory or the leader to first-attach them");
    expect(memory.contract).toContain("must not edit tracked project files or first-attach Work code SHAs");
    expect(memory.nextLeaderAction).toContain("structured quest metadata or route back to Work");
    expect(memory.leaderBrief).not.toContain("route back to Implement/Code Review/Port");
    expect(memory.assigneeBrief).not.toContain("Implement/Code Review/Port or a follow-up quest");
    expect(lifecycle).toContain("keep them in one quest and the same Work occurrence");
    expect(lifecycle).toContain(
      "same-quest implementation, design-only closure, or a separate implementation successor",
    );
    expect(lifecycle).toContain("Use a separate implementation quest only for genuinely optional or deferred work");
    expect(lifecycle).toContain("a materially different owner or schedule");
    expect(lifecycle).toContain("independent review");
    expect(lifecycle).toContain("materially distinct risk or audit isolation");
    expect(lifecycle).toContain("an explicit user-approved successor");
    expect(lifecycle).toContain("valid implementation successor is already active");
    expect(lifecycle).toContain("reconcile the quest metadata before resuming Work");
    expect(lifecycle).toContain("revise the title when it still reads as design-only");
    expect(lifecycle).toContain(
      "update the description and TLDR when they no longer cover the full approved design-and-build scope",
    );
    expect(lifecycle).toContain("Do not defer this correction to final Memory");
    expect(lifecycle).toContain("Before telling the user that a feature is implemented, available, or ready to test");
    expect(lifecycle).toContain("When the accepted outcome still includes implementation");
    expect(lifecycle).toContain("design-only or investigation quests may enter Memory");
    expect(lifecycle).toContain("worker returns the compact Work handoff and stops the Work turn");
    expect(lifecycle).toContain('--commits "sha1,sha2"');
    expect(lifecycle).toContain("--work-note <feedback-index> --no-code");
    expect(lifecycle).toContain("commit count and diff controls are available as soon as Memory begins");
    expect(lifecycle).toContain("older quest commits do not prove the current occurrence");
    expect(lifecycle).toContain("Memory must not first-attach accepted Work code SHAs");
    expect(lifecycle).toContain(
      "A planned checkpoint is optional only when its approved phase note states a concrete skip condition",
    );
    expect(lifecycle).toContain("Generic `board advance --skip-optional-checkpoint` remains blocked");
    expect(lifecycle).toContain("must be followed by a later Work occurrence before Memory");
    expect(lifecycle).toContain("Repeated plans may also use `board advance --skip-optional-checkpoint`");
    expect(lifecycle).toContain('--skip-optional-checkpoint "Work confirmed the approved skip condition."');
    expect(lifecycle).toContain("without waiting for Memory closure");
    expect(lifecycle).toContain("accepted-Work report normally carries the substantive answer");
    expect(lifecycle).toContain("Routine completion is commentary/status");
    expect(lifecycle).toContain("Ordinary read-only follow-up questions during Memory");
    expect(lifecycle).toContain("do not reopen the quest");
  });

  it("builds a read-only active v2 phase catalog with source metadata and exact display paths", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const catalog = await loadQuestJourneyPhaseCatalog({ packageRoot: PACKAGE_ROOT, companionHome });

    expect(catalog.map((phase) => phase.id)).toEqual(["alignment", "work", "user-checkpoint", "memory"]);
    expect(catalog[0]).toEqual(
      expect.objectContaining({
        id: "alignment",
        label: "Alignment",
        sourceType: "built-in",
        leaderBriefDisplayPath: "~/.companion/quest-journey-phases/alignment/leader.md",
        assigneeBriefDisplayPath: "~/.companion/quest-journey-phases/alignment/assignee.md",
      }),
    );
    expect(catalog.find((phase) => phase.id === "work")).toEqual(
      expect.objectContaining({
        boardState: "WORKING",
        assigneeRole: "worker",
        assigneeBriefDisplayPath: "~/.companion/quest-journey-phases/work/assignee.md",
      }),
    );
  });
});
