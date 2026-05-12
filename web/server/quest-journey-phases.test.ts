import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeQuestJourneyPhaseId,
  canonicalizeQuestJourneyState,
  QUEST_JOURNEY_PHASES,
} from "../shared/quest-journey.js";
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

describe("Quest Journey phase directory loading", () => {
  it("seeds and loads built-in phase directories from server-owned data", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });

    expect(phases.map((phase) => phase.id)).toEqual(QUEST_JOURNEY_PHASES.map((phase) => phase.id));
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

  it("refreshes built-in phase files from canonical repo data on reseed", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const alignmentPath = getQuestJourneyPhaseLeaderBriefPath("alignment", { companionHome });
    await writeFile(alignmentPath, "stale", "utf-8");

    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const refreshed = await readFile(alignmentPath, "utf-8");
    const canonical = await readFile(
      join(PACKAGE_ROOT, "shared", "quest-journey-phases", "alignment", "leader.md"),
      "utf-8",
    );

    expect(refreshed).toBe(canonical);
  });

  it("removes stale installed planning phase data without deleting canonical phases", async () => {
    const companionHome = await makeCompanionHome();
    const dataRoot = getQuestJourneyPhaseDataRoot({ companionHome });
    const stalePlanningDir = join(dataRoot, "planning");
    await mkdir(stalePlanningDir, { recursive: true });
    await writeFile(join(stalePlanningDir, "assignee.md"), "stale planning brief", "utf-8");

    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    await expect(readFile(join(stalePlanningDir, "assignee.md"), "utf-8")).rejects.toThrow();
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("alignment", { companionHome }), "utf-8"),
    ).resolves.toContain("Alignment -- Assignee Brief");
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("implement", { companionHome }), "utf-8"),
    ).resolves.toContain("Implement -- Assignee Brief");
  });

  it("refreshes runtime phase files from the package root nearest the session cwd", async () => {
    const companionHome = await makeCompanionHome();
    const repoRoot = await mkdtemp(join(tmpdir(), "quest-journey-worktree-repo-"));
    tmpHomes.push(repoRoot);

    const packageRoot = join(repoRoot, "web");
    const canonicalSource = join(PACKAGE_ROOT, "shared", "quest-journey-phases");
    const canonicalTarget = join(packageRoot, "shared", "quest-journey-phases");
    await mkdir(join(packageRoot, "shared"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"the-companion"}\n', "utf-8");
    await cp(canonicalSource, canonicalTarget, { recursive: true });

    const mentalSimulationAssignee = join(canonicalTarget, "mental-simulation", "assignee.md");
    await writeFile(
      mentalSimulationAssignee,
      "# Mental Simulation -- Assignee Brief\n\nFresh from worktree cwd.\n",
      "utf-8",
    );
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const refreshed = await ensureQuestJourneyPhaseDataForCwd(join(repoRoot, "nested", "session"), { companionHome });

    expect(refreshed).toBe(true);
    await expect(
      readFile(getQuestJourneyPhaseAssigneeBriefPath("mental-simulation", { companionHome }), "utf-8"),
    ).resolves.toContain("Fresh from worktree cwd");
  });

  it("seeds phase briefs with the execute and outcome-review responsibility boundaries", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const implementPhase = phases.find((phase) => phase.id === "implement");
    const executePhase = phases.find((phase) => phase.id === "execute");
    const outcomeReviewPhase = phases.find((phase) => phase.id === "outcome-review");

    expect(implementPhase?.leaderBrief).toContain("cheap, local, reversible outcome evidence");
    expect(implementPhase?.leaderBrief).toContain("normal investigation, root-cause analysis");
    expect(implementPhase?.leaderBrief).toContain("what that extra phase contributes");
    expect(implementPhase?.assigneeBrief).toContain("those belong in `EXECUTING`");
    expect(implementPhase?.assigneeBrief).toContain("code/design reading");
    expect(implementPhase?.assigneeBrief).toContain("Phase documentation");
    expect(implementPhase?.assigneeBrief).toContain("behavior or artifact change");
    expect(executePhase?.leaderBrief).toContain("Use `EXECUTING` instead of `IMPLEMENTING`");
    expect(executePhase?.assigneeBrief).toContain(
      "Do not turn this phase into the main implementation or debugging loop",
    );
    expect(outcomeReviewPhase?.leaderBrief).toContain("reviewer-owned acceptance phase");
    expect(outcomeReviewPhase?.leaderBrief).toContain("route back to `IMPLEMENTING`");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("small bounded checks or repros");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("do not become the primary experiment owner");
    expect(outcomeReviewPhase?.leaderBrief).toContain("context-specific memory deltas");
    expect(outcomeReviewPhase?.leaderBrief).toContain("assignee brief owns the standard catalog");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("memory catalog diff");
  });

  it("seeds alignment and explore briefs with the lightweight read-in contract", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const alignmentPhase = phases.find((phase) => phase.id === "alignment");
    const explorePhase = phases.find((phase) => phase.id === "explore");

    expect(alignmentPhase?.leaderBrief).toContain("exact prior messages, quests, or discussions");
    expect(alignmentPhase?.leaderBrief).toContain("run `memory catalog show` for orientation");
    expect(alignmentPhase?.leaderBrief).toContain("inspect with direct file tools");
    expect(alignmentPhase?.leaderBrief).toContain("memory reads should be visible");
    expect(alignmentPhase?.assigneeBrief).toContain("Takode and quest inspection tools");
    expect(alignmentPhase?.assigneeBrief).toContain("run `memory catalog show` visibly for orientation");
    expect(alignmentPhase?.assigneeBrief).toContain("inspect relevant memory files directly");
    expect(alignmentPhase?.assigneeBrief).toContain("memory files that materially affected the read-in");
    expect(alignmentPhase?.assigneeBrief).toContain("Concrete understanding:");
    expect(alignmentPhase?.assigneeBrief).toContain("Clarification questions:");
    expect(explorePhase?.leaderBrief).toContain("major findings, newly discovered ambiguities or blockers");
    expect(explorePhase?.leaderBrief).toContain("investigation is the deliverable");
    expect(explorePhase?.leaderBrief).toContain("Do not insert `EXPLORE -> IMPLEMENT`");
    expect(explorePhase?.leaderBrief).toContain("plan or revise to `USER_CHECKPOINTING`");
    expect(explorePhase?.assigneeBrief).toContain("major findings");
    expect(explorePhase?.assigneeBrief).toContain("evidence that may justify leader-owned Journey revision");
    expect(explorePhase?.assigneeBrief).toContain("routing decision point");
  });

  it("seeds User Checkpoint briefs as an intermediate user-participation phase", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const userCheckpointPhase = phases.find((phase) => phase.id === "user-checkpoint");

    expect(userCheckpointPhase?.boardState).toBe("USER_CHECKPOINTING");
    expect(userCheckpointPhase?.contract).toContain("required user decision");
    expect(userCheckpointPhase?.contract).toContain("not treat this as a terminal phase");
    expect(userCheckpointPhase?.leaderBrief).toContain("findings, options, tradeoffs, and a recommendation");
    expect(userCheckpointPhase?.leaderBrief).toContain("takode notify needs-input");
    expect(userCheckpointPhase?.leaderBrief).toContain("wait for the user answer");
    expect(userCheckpointPhase?.leaderBrief).toContain("revise the remaining Journey");
    expect(userCheckpointPhase?.leaderBrief).toContain("Do not use this phase as a terminal phase");
    expect(userCheckpointPhase?.assigneeBrief).toContain("required user answer");
    expect(userCheckpointPhase?.assigneeBrief).toContain("Journey-revision implications");
  });

  it("seeds reviewer briefs with target-specific skill and context loading guidance", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const codeReviewPhase = phases.find((phase) => phase.id === "code-review");
    const mentalSimulationPhase = phases.find((phase) => phase.id === "mental-simulation");
    const outcomeReviewPhase = phases.find((phase) => phase.id === "outcome-review");

    for (const phase of [codeReviewPhase, mentalSimulationPhase, outcomeReviewPhase]) {
      expect(phase?.leaderBrief).toContain("fresh reviewers");
      expect(phase?.leaderBrief).toContain("`quest` when reviewing quest state or feedback");
      expect(phase?.leaderBrief).toContain("`takode-orchestration` when inspecting prior sessions");
      expect(phase?.assigneeBrief).toContain("Load the essential skills and context");
      expect(phase?.assigneeBrief).toContain("load the `quest` skill");
      expect(phase?.assigneeBrief).toContain("load `takode-orchestration`");
      expect(phase?.assigneeBrief).toContain("Query board state only when");
    }
  });

  it("seeds Code Review briefs with comprehensive review and rework checkpoint guidance", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const codeReviewPhase = phases.find((phase) => phase.id === "code-review");

    // Code Review is the normal landing-risk gate, so the seeded runtime brief
    // must preserve both deeper review coverage and the clean rework diff rule.
    expect(codeReviewPhase?.contract).toContain("comprehensive landing risk");
    expect(codeReviewPhase?.contract).toContain("implementation completeness");
    expect(codeReviewPhase?.leaderBrief).toContain("comprehensive landing-risk review");
    expect(codeReviewPhase?.leaderBrief).toContain(
      "send the changed worktree back to Code Review only after that checkpoint exists",
    );
    expect(codeReviewPhase?.leaderBrief).toContain("purely read-only follow-up review discussion");
    expect(codeReviewPhase?.assigneeBrief).toContain("Start from the tracked diff");
    expect(codeReviewPhase?.assigneeBrief).toContain("meaningful evidence review");
    expect(codeReviewPhase?.assigneeBrief).toContain("implementation completeness");
    expect(codeReviewPhase?.assigneeBrief).toContain("Do not become the implementer, porter, or redesign owner");
    expect(codeReviewPhase?.assigneeBrief).toContain("small quest-hygiene issues");
    expect(codeReviewPhase?.assigneeBrief).toContain("Review documentation quality, not just presence");
    expect(codeReviewPhase?.assigneeBrief).toContain("quest documentation hygiene judgment");
  });

  it("seeds Mental Simulation briefs with abstract end-to-end validation boundaries", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const mentalSimulationPhase = phases.find((phase) => phase.id === "mental-simulation");

    expect(mentalSimulationPhase?.contract).toContain("abstract end-to-end correctness validation");
    expect(mentalSimulationPhase?.leaderBrief).toContain("abstract end-to-end correctness validation");
    expect(mentalSimulationPhase?.leaderBrief).toContain("Actual `EXECUTING` plus `OUTCOME_REVIEWING` is preferred");
    expect(mentalSimulationPhase?.assigneeBrief).toContain(
      "after implementation exists, or after the design is concrete enough",
    );
    expect(mentalSimulationPhase?.assigneeBrief).toContain(
      "Do not reject pre-implementation use when the leader has supplied a concrete enough design",
    );
    expect(mentalSimulationPhase?.assigneeBrief).toContain("when real execution is hard");
  });

  it("seeds all phase briefs with durable phase documentation guidance", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const phaseSpecificExpectations = new Map([
      ["alignment", "concrete understanding"],
      ["explore", "evidence sources"],
      ["implement", "behavior or artifact change"],
      ["code-review", "verdict first"],
      ["mental-simulation", "scenarios replayed"],
      ["execute", "monitor and stop conditions"],
      ["outcome-review", "evidence judged"],
      ["user-checkpoint", "required user answer"],
      ["port", "ordered synced SHAs"],
      ["memory", "final debrief metadata status"],
      ["bookkeeping", "records updated"],
    ]);

    for (const phase of phases) {
      expect(phase.assigneeBrief).toContain("Phase documentation");
      expect(phase.assigneeBrief).toContain("quest feedback add q-N --text-file");
      expect(phase.assigneeBrief).toContain("--tldr-file");
      expect(phase.assigneeBrief).toContain("preserve conclusions, decisions, evidence, blockers, risks");
      expect(phase.assigneeBrief).toContain("Use value-based compression instead of hard length caps");
      expect(phase.assigneeBrief).toContain("file-by-file diff narration");
      expect(phase.assigneeBrief).toContain("Keep the memory boundary explicit");
      expect(phase.assigneeBrief).toContain("current-phase inference");
      expect(phase.assigneeBrief).toContain("--no-phase");
      expect(phase.assigneeBrief).toContain("If context was compacted during this phase");
      expect(phase.assigneeBrief).toContain("Optional checkpoint");
      expect(phase.assigneeBrief).toContain("takode worker-stream");
      expect(phase.assigneeBrief).toContain("does not replace phase documentation");
      expect(phase.assigneeBrief).toContain(
        "[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)",
      );
      expect(phase.assigneeBrief).toContain("standard Markdown file links are best-effort fallback only");
      expect(phase.assigneeBrief).toContain(phaseSpecificExpectations.get(phase.id));
      expect(phase.leaderBrief).toContain("phase documentation");
      expect(phase.leaderBrief).toContain("full agent-oriented detail plus TLDR metadata");
      expect(phase.leaderBrief).toContain("Provide only deltas the assignee is unlikely to infer");
    }
  });

  it("seeds Bookkeeping briefs as cross-phase durable-state guidance", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const bookkeepingPhase = phases.find((phase) => phase.id === "bookkeeping");

    expect(bookkeepingPhase?.leaderBrief).toContain("compatibility phase");
    expect(bookkeepingPhase?.leaderBrief).toContain("not use Bookkeeping as a substitute for Memory closure");
    expect(bookkeepingPhase?.leaderBrief).toContain("file-based memory updates");
    expect(bookkeepingPhase?.leaderBrief).toContain("intended memory responsibility");
    expect(bookkeepingPhase?.leaderBrief).toContain("context-specific memory deltas");
    expect(bookkeepingPhase?.leaderBrief).toContain("relevant files or terms already inspected");
    expect(bookkeepingPhase?.leaderBrief).toContain("assignee brief owns the standard catalog-first reading");
    expect(bookkeepingPhase?.leaderBrief).toContain("write-lock, lint, diff, commit, release");
    expect(bookkeepingPhase?.leaderBrief).toContain("Override only with a context-specific expectation");
    expect(bookkeepingPhase?.leaderBrief).not.toContain("visible `memory catalog show`");
    expect(bookkeepingPhase?.leaderBrief).not.toContain("lint/doctor");
    expect(bookkeepingPhase?.assigneeBrief).toContain("Do not duplicate normal phase documentation");
    expect(bookkeepingPhase?.assigneeBrief).toContain("Final non-project-tracked quest closure belongs in `Memory`");
    expect(bookkeepingPhase?.assigneeBrief).toContain("session-space memory repo");
    expect(bookkeepingPhase?.assigneeBrief).toContain("auto-create the repo for the current server/session space");
    expect(bookkeepingPhase?.assigneeBrief).toContain("do not run a separate init step");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`current/` for live working state");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`knowledge/` for durable understanding");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`procedures/` for repeatable action");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`decisions/` for accepted choices or stable preferences");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`references/` for source digests or external pointers");
    expect(bookkeepingPhase?.assigneeBrief).toContain("`artifacts/` for produced external outputs");
    expect(bookkeepingPhase?.assigneeBrief).toContain("Run `memory catalog show` first");
    expect(bookkeepingPhase?.assigneeBrief).toContain("use `memory catalog diff` as a freshness check");
    expect(bookkeepingPhase?.assigneeBrief).toContain("not a reason for blind repo-wide search");
    expect(bookkeepingPhase?.assigneeBrief).toContain("inspect relevant existing memory files directly");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory lock acquire");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory lint");
    expect(bookkeepingPhase?.assigneeBrief).not.toContain("memory doctor");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory diff");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory commit");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory updated: <commit>");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory update deferred: <reason or curator>");
    expect(bookkeepingPhase?.assigneeBrief).toContain("memory update not needed: <reason>");
  });

  it("seeds Memory briefs as mandatory final durable-state closure", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const memoryPhase = phases.find((phase) => phase.id === "memory");

    expect(memoryPhase?.boardState).toBe("MEMORY");
    expect(memoryPhase?.contract).toContain("non-project-tracked durable-state closure");
    expect(memoryPhase?.contract).toContain("must not edit tracked project files");
    expect(memoryPhase?.leaderBrief).toContain("downstream-unblocking");
    expect(memoryPhase?.leaderBrief).toContain("worker or Port worker for routine closure");
    expect(memoryPhase?.leaderBrief).toContain(
      "independent reviewer for policy, provenance, or memory-consistency risk",
    );
    expect(memoryPhase?.leaderBrief).toContain("leader or curator for dependency, timer, notification");
    expect(memoryPhase?.leaderBrief).toContain("Do not ask Memory to edit tracked project files");
    expect(memoryPhase?.assigneeBrief).toContain("Run `memory catalog show` first");
    expect(memoryPhase?.assigneeBrief).toContain("memory catalog diff");
    expect(memoryPhase?.assigneeBrief).toContain("memory lock acquire");
    expect(memoryPhase?.assigneeBrief).toContain("memory updated: <commit>");
    expect(memoryPhase?.assigneeBrief).toContain("memory update deferred: <reason or curator>");
    expect(memoryPhase?.assigneeBrief).toContain("memory update not needed: <reason>");
    expect(memoryPhase?.assigneeBrief).toContain("Do not edit tracked project files");
    expect(memoryPhase?.assigneeBrief).toContain("final debrief metadata status");
  });

  it("seeds Port briefs with narrow sync guidance before final Memory", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const portPhase = phases.find((phase) => phase.id === "port");

    // Port is intentionally narrow. Final durable-state closure belongs in Memory.
    expect(portPhase?.leaderBrief).toContain("Treat Port as optional and narrow");
    expect(portPhase?.leaderBrief).toContain("does not own final Memory closure");
    expect(portPhase?.leaderBrief).toContain("advance to final Memory with the deferral context");
    expect(portPhase?.leaderBrief).toContain("Every non-cancelled quest should finish in final Memory");
    expect(portPhase?.leaderBrief).toContain("context-specific memory deltas");
    expect(portPhase?.leaderBrief).toContain("memory files or decisions already inspected");
    expect(portPhase?.leaderBrief).toContain("assignee brief owns the standard catalog-first reading");
    expect(portPhase?.leaderBrief).toContain("memory-statement mechanics");
    expect(portPhase?.leaderBrief).toContain("Keep durable memory writing out of normal Port");
    expect(portPhase?.leaderBrief).toContain("explicitly assign it");
    expect(portPhase?.leaderBrief).toContain("route a curator");
    expect(portPhase?.leaderBrief).not.toContain("Require `memory catalog show`");
    expect(portPhase?.assigneeBrief).toContain("Do not treat Port as final quest closure");
    expect(portPhase?.assigneeBrief).toContain("advance to final Memory after Port");
    expect(portPhase?.assigneeBrief).toContain("accepted-state summary");
    expect(portPhase?.assigneeBrief).toContain("memory catalog show");
    expect(portPhase?.assigneeBrief).toContain("memory catalog diff");
    expect(portPhase?.assigneeBrief).toContain("inspect relevant memory files directly");
    expect(portPhase?.assigneeBrief).toContain("Port does not normally author durable memory");
    expect(portPhase?.assigneeBrief).toContain("memory update deferred: <Memory/curator/reason>");
    expect(portPhase?.assigneeBrief).toContain("memory update not needed: <reason>");
    expect(portPhase?.assigneeBrief).toContain("memory updated: <commit>");
    expect(portPhase?.assigneeBrief).toContain("only when memory writing was explicitly assigned to Port");
    expect(portPhase?.assigneeBrief).not.toContain("memory lock acquire");
    expect(portPhase?.assigneeBrief).not.toContain("memory lint");
    expect(portPhase?.assigneeBrief).not.toContain("memory doctor");
    expect(portPhase?.assigneeBrief).not.toContain("memory diff");
    expect(portPhase?.assigneeBrief).not.toContain("memory commit");
    expect(portPhase?.assigneeBrief).toContain("Document ordered synced SHAs");
    expect(portPhase?.assigneeBrief).toContain("memory statement");
  });

  it("seeds Port briefs with the strong code/test pre-push verification gate", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const portPhase = phases.find((phase) => phase.id === "port");

    expect(portPhase?.leaderBrief).toContain("strong Port verification gate for tracked code/test changes");
    expect(portPhase?.leaderBrief).toContain("focused affected tests plus full `bun run test`");
    expect(portPhase?.leaderBrief).toContain("before push");
    expect(portPhase?.leaderBrief).toContain("explicit infeasibility exception");
    expect(portPhase?.leaderBrief).toContain("route the worker back to fix it");
    expect(portPhase?.leaderBrief).toContain("open an immediate fix quest");
    expect(portPhase?.leaderBrief).toContain("already an active quest for that failure");

    expect(portPhase?.assigneeBrief).toContain("strong Port verification gate by default");
    expect(portPhase?.assigneeBrief).toContain("focused affected tests plus full `bun run test`");
    expect(portPhase?.assigneeBrief).toContain("before pushing");
    expect(portPhase?.assigneeBrief).toContain("skipped or failed full-suite evidence");
    expect(portPhase?.assigneeBrief).toContain("pre-push and post-push verification results");
  });

  it("seeds review phases with documentation quality checks", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const codeReviewPhase = phases.find((phase) => phase.id === "code-review");
    const outcomeReviewPhase = phases.find((phase) => phase.id === "outcome-review");

    for (const phase of [codeReviewPhase, outcomeReviewPhase]) {
      expect(phase?.assigneeBrief).toContain("Review documentation quality, not just presence");
      expect(phase?.assigneeBrief).toContain("useful full detail");
      expect(phase?.assigneeBrief).toContain("TLDR metadata");
      expect(phase?.assigneeBrief).toContain("correctly phase-associated");
      expect(phase?.leaderBrief).toContain("Require reviewers to judge phase documentation quality");
    }
  });

  it("seeds review phases with tracked documentation gate guidance", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const codeReviewPhase = phases.find((phase) => phase.id === "code-review");
    const outcomeReviewPhase = phases.find((phase) => phase.id === "outcome-review");

    expect(codeReviewPhase?.leaderBrief).toContain("Missing tracked follow-up belongs back in Implement");
    expect(codeReviewPhase?.assigneeBrief).toContain(
      "Missing tracked docs or instruction work is a Code Review finding",
    );
    expect(codeReviewPhase?.assigneeBrief).toContain("do not defer it to final Memory");

    expect(outcomeReviewPhase?.leaderBrief).toContain("tracked docs, instructions, tests, fixtures");
    expect(outcomeReviewPhase?.leaderBrief).toContain("final Memory may route them but must not patch them");
    expect(outcomeReviewPhase?.leaderBrief).toContain("Final debrief draft:");
    expect(outcomeReviewPhase?.leaderBrief).toContain("Debrief TLDR draft:");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("tracked docs, instructions, tests, fixtures");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("do not defer tracked fixes to final Memory");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("Final debrief draft:");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("Debrief TLDR draft:");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("final Memory will need leader help");
  });

  it("builds a read-only phase catalog with source metadata and exact display paths", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const catalog = await loadQuestJourneyPhaseCatalog({ packageRoot: PACKAGE_ROOT, companionHome });

    expect(catalog.map((phase) => phase.id)).toEqual(QUEST_JOURNEY_PHASES.map((phase) => phase.id));
    expect(catalog[0]).toEqual(
      expect.objectContaining({
        id: "alignment",
        label: "Alignment",
        boardState: "PLANNING",
        assigneeRole: "worker",
        sourceType: "built-in",
        dirDisplayPath: "~/.companion/quest-journey-phases/alignment",
        phaseJsonDisplayPath: "~/.companion/quest-journey-phases/alignment/phase.json",
        leaderBriefDisplayPath: "~/.companion/quest-journey-phases/alignment/leader.md",
        assigneeBriefDisplayPath: "~/.companion/quest-journey-phases/alignment/assignee.md",
      }),
    );
    expect(catalog[0]?.sourcePath).toBe(join(PACKAGE_ROOT, "shared", "quest-journey-phases", "alignment"));
    expect(catalog[0]?.aliases).toContain("planning");
  });

  it("keeps internal compatibility aliases after removing legacy skill aliases", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const catalog = await loadQuestJourneyPhaseCatalog({ packageRoot: PACKAGE_ROOT, companionHome });
    const aliasesByPhase = Object.fromEntries(catalog.map((phase) => [phase.id, phase.aliases]));

    expect(aliasesByPhase.alignment).toContain("planning");
    expect(aliasesByPhase.implement).toContain("implementation");
    expect(aliasesByPhase["code-review"]).toEqual(expect.arrayContaining(["skeptic-review", "reviewer-groom"]));
    expect(aliasesByPhase.port).toContain("porting");
    expect(aliasesByPhase.memory).toContain("final-memory");
    expect(canonicalizeQuestJourneyPhaseId("planning")).toBe("alignment");
    expect(canonicalizeQuestJourneyPhaseId("implementation")).toBe("implement");
    expect(canonicalizeQuestJourneyPhaseId("skeptic-review")).toBe("code-review");
    expect(canonicalizeQuestJourneyPhaseId("reviewer-groom")).toBe("code-review");
    expect(canonicalizeQuestJourneyPhaseId("porting")).toBe("port");
    expect(canonicalizeQuestJourneyPhaseId("final-memory")).toBe("memory");
    expect(canonicalizeQuestJourneyState("SKEPTIC_REVIEWING")).toBe("CODE_REVIEWING");
    expect(canonicalizeQuestJourneyState("GROOM_REVIEWING")).toBe("CODE_REVIEWING");
  });
});
