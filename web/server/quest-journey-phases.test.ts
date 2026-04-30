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
    expect(implementPhase?.assigneeBrief).toContain("those belong in `EXECUTING`");
    expect(implementPhase?.assigneeBrief).toContain("Phase documentation");
    expect(implementPhase?.assigneeBrief).toContain("changed files or artifacts");
    expect(executePhase?.leaderBrief).toContain("Use `EXECUTING` instead of `IMPLEMENTING`");
    expect(executePhase?.assigneeBrief).toContain(
      "Do not turn this phase into the main implementation or debugging loop",
    );
    expect(outcomeReviewPhase?.leaderBrief).toContain("reviewer-owned acceptance phase");
    expect(outcomeReviewPhase?.leaderBrief).toContain("route back to `IMPLEMENTING`");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("small bounded checks or repros");
    expect(outcomeReviewPhase?.assigneeBrief).toContain("do not become the primary experiment owner");
  });

  it("seeds alignment and explore briefs with the lightweight read-in contract", async () => {
    const companionHome = await makeCompanionHome();
    await ensureBuiltInQuestJourneyPhaseData({ packageRoot: PACKAGE_ROOT, companionHome });

    const phases = await loadBuiltInQuestJourneyPhases({ companionHome });
    const alignmentPhase = phases.find((phase) => phase.id === "alignment");
    const explorePhase = phases.find((phase) => phase.id === "explore");

    expect(alignmentPhase?.leaderBrief).toContain("exact prior messages, quests, or discussions");
    expect(alignmentPhase?.assigneeBrief).toContain("Takode and quest inspection tools");
    expect(alignmentPhase?.assigneeBrief).toContain("Concrete understanding:");
    expect(alignmentPhase?.assigneeBrief).toContain("Clarification questions:");
    expect(explorePhase?.leaderBrief).toContain("major findings, newly discovered ambiguities or blockers");
    expect(explorePhase?.assigneeBrief).toContain("major findings");
    expect(explorePhase?.assigneeBrief).toContain("evidence that may justify leader-owned Journey revision");
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
      ["implement", "changed files or artifacts"],
      ["code-review", "review scope"],
      ["mental-simulation", "scenarios replayed"],
      ["execute", "monitor and stop conditions"],
      ["outcome-review", "evidence judged"],
      ["bookkeeping", "shared records updated"],
      ["port", "ordered synced SHAs"],
    ]);

    for (const phase of phases) {
      expect(phase.assigneeBrief).toContain("Phase documentation");
      expect(phase.assigneeBrief).toContain("quest feedback add q-N --text-file");
      expect(phase.assigneeBrief).toContain("--tldr-file");
      expect(phase.assigneeBrief).toContain("current-phase inference");
      expect(phase.assigneeBrief).toContain("--no-phase");
      expect(phase.assigneeBrief).toContain(
        "[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)",
      );
      expect(phase.assigneeBrief).toContain("standard Markdown file links are best-effort fallback only");
      expect(phase.assigneeBrief).toContain(phaseSpecificExpectations.get(phase.id));
      expect(phase.leaderBrief).toContain("phase documentation");
      expect(phase.leaderBrief).toContain("full agent-oriented detail plus TLDR metadata");
    }
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
});
