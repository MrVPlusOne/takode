import { describe, expect, it } from "vitest";
import {
  buildCompanionInstructions,
  buildInjectedSystemPromptForDebug,
  getOrchestratorGuardrails,
} from "./cli-launcher-instructions.js";

describe("buildCompanionInstructions", () => {
  it("includes the leader-reply rule for Claude sessions", () => {
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "claude" });
    // Claude workers must see this rule so they don't try tool-based replies
    expect(result).toContain("## Responding to Leaders");
    expect(result).toContain("Do NOT use `SendMessage`");
    expect(result).toContain("SendMessageToLeader");
    expect(result).toContain("herd events");
  });

  it("includes the leader-reply rule when backend is unspecified (defaults to Claude-like)", () => {
    const result = buildCompanionInstructions({ sessionNum: 1 });
    expect(result).toContain("## Responding to Leaders");
  });

  it("excludes the leader-reply rule for Codex sessions", () => {
    // Codex doesn't have SendMessage tools, so the rule is unnecessary
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "codex" });
    expect(result).not.toContain("## Responding to Leaders");
    expect(result).not.toContain("SendMessageToLeader");
  });

  it("includes session identity when sessionNum is provided", () => {
    const result = buildCompanionInstructions({ sessionNum: 42 });
    expect(result).toContain("Takode session #42");
  });

  it("includes Takode file-link guidance for quest comments and phase documentation", () => {
    const result = buildCompanionInstructions({ sessionNum: 42, backend: "codex" });
    expect(result).toContain("[app.ts:42](file:src/app.ts:42)");
    expect(result).toContain("including in quest comments and phase documentation");
    expect(result).toContain("Do not use `file://` URI schemes");
  });

  it("keeps quest IDs out of Takode-external durable names while preserving internal uses", () => {
    for (const backend of ["claude", "codex"] as const) {
      const result = buildCompanionInstructions({ sessionNum: 42, backend });
      expect(result).toContain("## Durable Names and Quest IDs");
      expect(result).toContain("Quest IDs such as `q-1234` are local Takode coordination identifiers");
      expect(result).toContain("quest comments and feedback");
      expect(result).toContain("session/thread routing");
      expect(result).toContain("board state");
      expect(result).toContain("Takode links");
      expect(result).toContain("phase notes");
      expect(result).toContain("memory source/provenance metadata");
      expect(result).toContain("Do not put quest IDs in Takode-external durable names");
      expect(result).toContain("code identifiers");
      expect(result).toContain("filenames or directories");
      expect(result).toContain("dataset/artifact/checkpoint/debug paths");
      expect(result).toContain("retained job or run labels");
      expect(result).toContain("PR titles or descriptions");
      expect(result).toContain("commit subjects or bodies");
      expect(result).toContain("user-facing durable labels");
      expect(result).toContain("Use descriptive names from the project, source, date range, content, or purpose");
      expect(result).toContain("record quest provenance in Questmaster or memory metadata");
    }
  });

  it("includes catalog-first file-based memory and write-lock guidance", () => {
    const result = buildCompanionInstructions({ sessionNum: 42, backend: "codex" });

    expect(result).toContain("## File-Based Memory");
    expect(result).toContain("Git-tracked Markdown repo for this server/session space");
    expect(result).toContain("~/.companion/memory/<serverSlug>/<sessionSpace>");
    expect(result).toContain("~/.companion/memory/prod/Takode");
    expect(result).toContain("normal `memory` commands auto-create the repo and authored directories");
    expect(result).toContain("Use visible memory reads and explicit writes");
    expect(result).toContain("Do not treat an official repo doc, skill, or quest note as automatic proof");
    expect(result).toContain("capture a concise memory decision/pointer");
    expect(result).toContain("defer memory writing to Memory/curation");
    expect(result).toContain("use `memory catalog show` as the triage map");
    expect(result).toContain("use `memory catalog diff` as a freshness check");
    expect(result).toContain("Do not run catalog diff constantly");
    expect(result).toContain("it is not a replacement for direct file inspection");
    expect(result).toContain("The catalog prints the repo root and repo-relative file paths");
    expect(result).toContain("inspect plausible catalog-listed Markdown files directly with normal tools");
    expect(result).toContain("`rg`, `sed`, and `cat`");
    expect(result).toContain("memory catalog");
    expect(result).toContain("memory repo path");
    expect(result).toContain("memory --help");
    expect(result).toContain(
      "Use targeted `rg` under `$(memory repo path)` only when the catalog or known context makes a match plausible",
    );
    expect(result).toContain("skip blind repo-wide memory search");
    expect(result).toContain("there is no authored `indexes/` directory");
    expect(result).not.toContain('memory recall "<current task terms>"');
    expect(result).not.toContain("memory repo init");
    expect(result).toContain("current/");
    expect(result).toContain("knowledge/");
    expect(result).toContain("procedures/");
    expect(result).toContain("decisions/");
    expect(result).toContain("references/");
    expect(result).toContain("artifacts/");
    expect(result).toContain("memory lock acquire --owner");
    expect(result).toContain("For memory record frontmatter `source`");
    expect(result).toContain("use the quest ID (`q-N`) as the primary source");
    expect(result).toContain("Do not routinely add `commit:*` or `session:*` sources");
    expect(result).toContain("final Memory must include exactly one memory statement");
    expect(result).toContain("memory updated: <commit>");
    expect(result).toContain("memory update deferred: <reason or curator>");
    expect(result).toContain("memory update not needed: <reason>");
    expect(result).toContain("Non-Memory phases should not add routine `memory update not needed` statements");
  });

  it("includes worktree guardrails when worktree is provided", () => {
    const result = buildCompanionInstructions({
      worktree: { branch: "test-branch", repoRoot: "/repo" },
    });
    expect(result).toContain("Worktree Session");
    expect(result).toContain("test-branch");
    expect(result).toContain("Base branch / port target: `test-branch`");
  });

  it("uses explicit worktree port target in sync context", () => {
    const result = buildCompanionInstructions({
      worktree: {
        branch: "leader-target-wt-1234-wt-5678",
        parentBranch: "leader-target-wt-1234",
        repoRoot: "/repo",
        portTarget: {
          repoRoot: "/repo",
          branch: "leader-target-wt-1234",
          worktreePath: "/worktrees/repo/leader-target-wt-1234",
          sourceSessionNum: 7,
          sourceLabel: "#7 Leader WT",
        },
      },
    });

    expect(result).toContain("leader-target-wt-1234-wt-5678");
    expect(result).toContain("Base branch / port target: `leader-target-wt-1234`");
    expect(result).toContain("Port target worktree: `/worktrees/repo/leader-target-wt-1234`");
    expect(result).toContain("Port target source: #7 Leader WT");
  });

  it("renders explicit leader worktree targets from worker sync metadata", () => {
    const result = buildCompanionInstructions({
      worktree: {
        branch: "main-wt-5892-wt-6573",
        parentBranch: "main-wt-5892",
        repoRoot: "/Users/jiayiwei/Code/yolo",
        portTarget: {
          repoRoot: "/Users/jiayiwei/Code/yolo",
          branch: "main-wt-5892",
          worktreePath: "/Users/jiayiwei/.companion/worktrees/yolo/main-wt-5892",
          sourceSessionNum: 2078,
          sourceLabel: "#2078 QA Data Leader",
        },
      },
    });

    expect(result).toContain("Base repo checkout: `/Users/jiayiwei/Code/yolo`");
    expect(result).toContain("Base branch / port target: `main-wt-5892`");
    expect(result).toContain("Port target worktree: `/Users/jiayiwei/.companion/worktrees/yolo/main-wt-5892`");
    expect(result).toContain("Port target source: #2078 QA Data Leader");
  });

  it("orders leader needs-input notifications after explicit user-visible text", () => {
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "codex" });
    // Agents must make the actual question or decision visible before firing
    // the notification chip; otherwise the user sees an alert without context.
    expect(result).toContain("first send the detailed question, decision options, or confirmation text");
    expect(result).toContain("`[thread:main]` or `[thread:q-N]`");
    expect(result).toContain("standalone `---` line immediately before each later `[thread:main]` or `[thread:q-N]`");
    expect(result).toContain("normal worker and reviewer sessions use ordinary assistant text");
    expect(result).toContain("After that text is visible, call `takode notify needs-input`");
    expect(result).toContain("Do not fire the notification before the detailed text is visible");
    expect(result).toContain("The visible thread text is the decision surface");
    expect(result).toContain("complete context needed to answer, including options and tradeoffs when relevant");
    expect(result).toContain("notification summaries, notification UI options, and `--suggest` choices");
    expect(result).toContain("Any user wait, including approvals, confirmations");
    expect(result).toContain("never represent a user wait only with `Thread Waiting`");
    expect(result).toContain("`Thread Waiting` or `takode notify waiting`");
    expect(result).toContain("New blocking prompt -> new `needs-input` notification");
    expect(result).toContain(
      "existing unresolved prompts in the same thread or quest do not cover a separate approval or decision",
    );
    expect(result).toContain("Link the affected active board row with `--wait-for-input` when applicable");
    expect(result).toContain("you may add `--suggest <answer>` options");
    expect(result).not.toContain("one to three `--suggest <answer>` options");
    expect(result).toContain("never use suggestions instead of writing the full context in chat");
    expect(result).toContain("use scoped waits for `needs-input`");
    expect(result).toContain("blocks only its own thread, quest, or board row");
    expect(result).toContain("do not answer the user decision yourself");
    expect(result).toContain("global orchestration, worker-slot scheduling, shared resource safety");
    expect(result).toContain("parks one `needs-input` prompt");
    expect(result).toContain("`waiting`");
    expect(result).toContain("Legacy CLI status for sessions that are parked on non-user work only");
    expect(result).toContain("Leader/orchestrator threads should prefer inline `Thread Waiting` markers");
    expect(result).toContain("Use `Thread Waiting` only for non-user waits");
  });

  it("includes global resource lease guidance for shared dev-server and browser work", () => {
    const result = buildCompanionInstructions({ sessionNum: 1, backend: "codex" });
    // Shared browser and dev-server workflows can conflict across active agents,
    // so every backend gets the same CLI-first coordination instructions.
    expect(result).toContain("## Global Resource Leases");
    expect(result).toContain("You must acquire the relevant `takode lease`");
    expect(result).toContain("status is not a substitute for holding the lease");
    expect(result).toContain("takode lease status dev-server:companion");
    expect(result).toContain("takode lease acquire agent-browser");
    expect(result).toContain("Heartbeat while actively using the resource");
    expect(result).toContain("they do not enforce process startup ownership");
  });

  it("appends extraInstructions at the end", () => {
    const result = buildCompanionInstructions({
      backend: "claude",
      extraInstructions: "EXTRA_MARKER",
    });
    expect(result).toContain("EXTRA_MARKER");
    // Extra instructions should come after the base sections
    const leaderIdx = result.indexOf("## Responding to Leaders");
    const extraIdx = result.indexOf("EXTRA_MARKER");
    expect(extraIdx).toBeGreaterThan(leaderIdx);
  });
});

describe("getOrchestratorGuardrails", () => {
  it("returns claude-flavored guardrails by default", () => {
    const result = getOrchestratorGuardrails();
    expect(result).toContain("orchestrator agent");
    expect(result).toContain("/quest-design");
    expect(result).toContain("true follow-up of earlier work");
    expect(result).toContain("Relationship: follow-up of [q-N](quest:q-N)");
    expect(result).toContain("quest create ... --follow-up-of q-N");
    expect(result).toContain("## Durable Names in Handoffs");
    expect(result).toContain("keep quest IDs out of the Takode-external durable names");
    expect(result).toContain("Do not ask for a `q-N`-specific destination, filename, job label");
    expect(result).toContain("commit message, or PR description");
    expect(result).toContain("source, date range, scope, or purpose");
    expect(result).toContain("direct-dispatch versus approval decision");
    expect(result).toContain("durable board recording");
    expect(result).toContain("Direct create/dispatch is allowed only for clear, low-risk, reversible repo-local work");
    expect(result).toContain("Pre-dispatch approval remains mandatory for ambiguous");
    expect(result).toContain("Use delayed approval via User Checkpoint");
    expect(result).toContain("visible chat approval surface is for the user's decision, not worker grounding");
    expect(result).toContain("make it read like a TLDR for approval");
    expect(result).toContain("Move most detailed grounding, evidence, acceptance bullets, non-goals");
    expect(result).toContain("Standard phases are recommended defaults, not mandates");
    expect(result).toContain("ask what it contributes over merging that work into a later phase");
    expect(result).toContain("`implement` includes normal investigation, root-cause analysis");
    expect(result).toContain("Explore is for investigation deliverables or unknown routing");
    expect(result).toContain("Never propose adjacent `explore -> implement`");
    expect(result).toContain("`explore -> user-checkpoint -> implement`");
    expect(result).toContain("After a legitimate Explore has completed");
    expect(result).toContain("User Checkpoint is an intermediate user-participation stop");
    expect(result).toContain("self-contained packet with findings, named options, key tradeoffs");
    expect(result).toContain("exact requested answer");
    expect(result).toContain(
      "material parameter edits, approval-impacting corrections, or approval-impacting questions",
    );
    expect(result).toContain("publish a revised exact packet");
    expect(result).toContain("Harmless typo-only corrections can be recorded");
    expect(result).toContain('"LGTM", "approved", "run it"');
    expect(result).toContain("User Checkpoints are mandatory by default");
    expect(result).toContain(
      "A completed-Explore `takode board revise` may drop the immediate post-Explore checkpoint",
    );
    expect(result).toContain("If the user explicitly asked for the User Checkpoint or the decision truly needs input");
    expect(result).toContain("notify the user and wait");
    expect(result).toContain("Omit notes for standard phases by default");
    expect(result).toContain("Phase documentation should be useful, not ritual");
    expect(result).toContain("Use value-based compression instead of hard length caps");
    expect(result).toContain("file-by-file diff narration");
    expect(result).toContain("Keep the memory boundary explicit");
    expect(result).toContain("Non-Memory phases should not add routine `memory update not needed` statements");
    expect(result).toContain("quest-backed updates should use `q-N`");
    expect(result).toContain("should not routinely add `commit:*` or `session:*` sources");
    expect(result).toContain("Provide only deltas the actor is unlikely to infer");
    expect(result).toContain("Alignment approval is leader-owned by default");
    expect(result).toContain("Escalate alignment back to the user only");
    expect(result).toContain("send the changed worktree back to Code Review only after that checkpoint exists");
    expect(result).toContain("separate follow-up commit");
    expect(result).toContain("does not apply to purely read-only follow-up review discussion");
    expect(result).toContain(
      "Use `mental-simulation` when the question is whether a design, workflow, or responsibility split makes sense",
    );
    expect(result).toContain("reviewers may do only small bounded reruns or repros");
    expect(result).toContain("approval-gated runs");
    expect(result).toContain("route back deliberately: `implement`");
    expect(result).toContain("point the worker at the exact prior messages, quests, or discussions");
    expect(result).toContain("After that user-visible text exists, call `takode notify needs-input`");
    expect(result).toContain("The visible thread text is the decision surface");
    expect(result).toContain("notification summaries, notification UI options, and `--suggest` choices");
    expect(result).toContain("Any user wait, including approvals, confirmations");
    expect(result).toContain("never represent a user wait only with `Thread Waiting`");
    expect(result).toContain("Apply the scoped-wait rule for `needs-input`");
    expect(result).toContain("pause only the owning thread, quest, or board row");
    expect(result).toContain("work elsewhere");
    expect(result).toContain("does not depend on that unresolved decision");
    expect(result).toContain("`Thread Waiting` is only for non-user waits");
    expect(result).toContain("Keep unrelated herd events and quests moving");
    expect(result).toContain("## Memory-Aware Orchestration");
    expect(result).toContain("Use `memory catalog show` visibly");
    expect(result).toContain("then inspect plausible catalog-listed files directly");
    expect(result).toContain("ensure the worker has seen the latest catalog");
    expect(result).toContain("`memory catalog diff`");
    expect(result).toContain(
      "Use targeted memory repo search only when the catalog or known context makes a match plausible",
    );
    expect(result).toContain("either point them to the catalog/direct-file workflow");
    expect(result).not.toContain("Use `memory recall` visibly");
    expect(result).toContain("Do not silently inject memory into workers");
    expect(result).toContain("Memory writes are explicit Journey responsibility");
    expect(result).toContain("System-interrupted worker `turn_end` herd events are actionable but not always terminal");
    expect(result).toContain("If an event says `recovery pending`");
    expect(result).toContain("consider a simple continuation or a short timer/recheck");
    expect(result).toContain("take over only when recovery failed");
    expect(result).toContain("Fresh worker is the default");
    expect(result).toContain("disconnected availability is not a reuse reason");
    expect(result).toContain("reuse disconnected workers only when they have a real context advantage");
    expect(result).not.toContain("Prefer reusing disconnected workers over spawning fresh sessions");
  });

  it("returns codex-flavored guardrails for codex backend", () => {
    const result = getOrchestratorGuardrails("codex");
    expect(result).toContain("orchestrator leader session");
    expect(result).toContain("/quest-design");
    expect(result).toContain("persist it with `--follow-up-of`");
    expect(result).toContain("## Durable Names in Handoffs");
    expect(result).toContain("keep quest IDs out of the Takode-external durable names");
    expect(result).toContain("Do not ask for a `q-N`-specific destination, filename, job label");
    expect(result).toContain("commit message, or PR description");
    expect(result).toContain("direct-dispatch versus approval decision");
    expect(result).toContain("write the authorized Journey to the board before or with dispatch");
    expect(result).toContain("Alignment approval is leader-owned by default");
    expect(result).toContain("Escalate alignment back to the user only");
    expect(result).toContain("send the changed worktree back to Code Review only after that checkpoint exists");
    expect(result).toContain("does not apply to purely read-only follow-up review discussion");
    expect(result).toContain("delegate_command(command)");
    expect(result).toContain("inspectable forked transcript");
    expect(result).toContain("If the user explicitly asks you to use `delegate_command`");
    expect(result).toContain("make your next action the actual MCP tool call");
    expect(result).toContain("Apply the scoped-wait rule for `needs-input`");
    expect(result).toContain("work elsewhere");
    expect(result).toContain("Any user wait, including approvals, confirmations");
    expect(result).toContain("never represent a user wait only with `Thread Waiting`");
    expect(result).toContain("After `execute`, leaders may accept evidence directly");
    expect(result).toContain("Lightweight leader inspection is enough");
    expect(result).toContain("independent review would not materially reduce risk");
    expect(result).toContain("Use `outcome-review` when a reviewer should make an acceptance judgment");
    expect(result).toContain("independent judgment materially reduces risk");
    expect(result).toContain("small bounded reruns or repros");
    expect(result).toContain("approval-gated runs");
    expect(result).toContain("System-interrupted worker `turn_end` herd events are actionable but not always terminal");
    expect(result).toContain("the worker still appears connected or generating");
    expect(result).toContain("Fresh worker is the default");
    expect(result).toContain("disconnected availability is not a reuse reason");
    expect(result).toContain("reuse disconnected workers only when they have a real context advantage");
    expect(result).not.toContain("Prefer reusing disconnected workers over spawning fresh sessions");
  });
});

describe("buildInjectedSystemPromptForDebug", () => {
  it("builds a full offline leader prompt without a live server", () => {
    const result = buildInjectedSystemPromptForDebug({
      sessionNum: 7,
      backend: "claude",
      isOrchestrator: true,
      worktree: { branch: "jiayi-wt-1234", repoRoot: "/repo", parentBranch: "jiayi" },
    });

    expect(result).toContain("You are Takode session #7.");
    expect(result).toContain("Worktree Session");
    expect(result).toContain("## Durable Names and Quest IDs");
    expect(result).toContain("Do not put quest IDs in Takode-external durable names");
    expect(result).toContain("PR titles or descriptions");
    expect(result).toContain("commit subjects or bodies");
    expect(result).toContain("Takode -- Cross-Session Orchestration");
    expect(result).toContain("## Durable Names in Handoffs");
    expect(result).toContain("Do not ask for a `q-N`-specific destination");
    expect(result).toContain("Every dispatched task follows a **Quest Journey** assembled from phases");
    expect(result).toContain("Use `/quest-design` before creating or materially refining quest text");
    expect(result).toContain("explicitly check whether the quest is a true follow-up to earlier work");
    expect(result).toContain("Relationship: follow-up of [q-N](quest:q-N)");
    expect(result).toContain("Use `/leader-dispatch` before dispatching a fresh or newly refined quest");
    expect(result).toContain("After you say you will create, refine, dispatch, or advance a quest");
    expect(result).toContain("complete and verify the durable record in that same turn");
    expect(result).toContain("do not mark the thread Ready; mark it Waiting or incomplete");
    expect(result).toContain("Avoid broad mixed context dumps as the final step before setup");
    expect(result).toContain("choose direct dispatch, pre-dispatch approval, or delayed approval via User Checkpoint");
    expect(result).toContain("Direct create/dispatch is allowed only for clear, low-risk, reversible repo-local work");
    expect(result).toContain("Pre-dispatch approval remains mandatory for ambiguous");
    expect(result).toContain("Use delayed approval via User Checkpoint");
    expect(result).toContain(
      "material parameter edits, approval-impacting corrections, or approval-impacting questions",
    );
    expect(result).toContain("advance only after explicit approval of that revised packet");
    expect(result).toContain("exact action and no approval ambiguity remains");
    expect(result).toContain("Use `Goal / Acceptance` as the source of truth for the requested work");
    expect(result).toContain("make it read like a TLDR for approval");
    expect(result).toContain("Move most detailed grounding, evidence, acceptance bullets, non-goals");
    expect(result).toContain("preserve judgment, but expand only for ambiguity");
    expect(result).toContain("the thread text must include enough decision context for that choice");
    expect(result).toContain(
      "notification suggestions and quest feedback are not substitutes for options or tradeoffs",
    );
    expect(result).toContain("do not restate the same work again as a separate quest description");
    expect(result).toContain("full quest-body paste");
    expect(result).toContain("The visible chat approval surface is for the user's decision, not worker grounding");
    expect(result).toContain("the quest record should hold detailed worker grounding");
    expect(result).toContain("The compact proposal shape is a menu, not a form");
    expect(result).toContain("omit optional headings or explanatory bullets unless they add decision value");
    expect(result).toContain("Include exact wait-for reasons, replacement/archive fallback mechanics");
    expect(result).toContain("optional `Context / Evidence`");
    expect(result).toContain("`Invariants / Must Preserve`");
    expect(result).toContain("quest-design-only requests");
    expect(result).toContain("dispatch-only requests");
    expect(result).toContain(
      "questions and assumptions should not restate facts already implied by `Goal / Acceptance`",
    );
    expect(result).toContain("board-owned draft-or-active state for the quest");
    expect(result).toContain("Standard phases are recommended defaults, not mandates");
    expect(result).toContain("ask what it contributes over merging that work into a later phase");
    expect(result).toContain("USER_CHECKPOINTING");
    expect(result).toContain("User Checkpoint");
    expect(result).toContain("Do not use it as terminal closure, generic TBD, or optional leader-only indecision");
    expect(result).toContain("Optional future phases are explicit Journey guidance");
    expect(result).toContain("do not invent or rely on a generic optional-phase skip command");
    expect(result).toContain("Omit notes for standard phases by default");
    expect(result).toContain("write the authorized Journey to the board before or with dispatch");
    expect(result).toContain("Initial Journey authorization comes before dispatch");
    expect(result).toContain("concise leader-verification read-in");
    expect(result).toContain("not a broad planning report");
    expect(result).toContain("broad implementation plans, exhaustive evidence inventories");
    expect(result).toContain("not a routine second user-approval gate");
    expect(result).toContain("Alignment approval is leader-owned by default");
    expect(result).toContain("Every active phase needs durable quest documentation");
    expect(result).toContain("Phase-note TLDRs should be 1-5 scan-friendly bullets or sentences");
    expect(result).toContain("raw SHAs, branch names, exhaustive command lists");
    expect(result).toContain("dedicated `Synced SHAs:` lines");
    expect(result).toContain("Final debrief TLDRs and routine user-facing summaries should describe");
    expect(result).toContain("without repeating raw commit hashes already carried");
    expect(result).toContain("When telling the user a quest is complete");
    expect(result).toContain("lead with the delivered result or decision, why it matters");
    expect(result).toContain("final debrief metadata status, no-op memory statements");
    expect(result).toContain("{[(Quest Quiz: q-N)]}");
    expect(result).toContain("Phase documentation should be useful, not ritual");
    expect(result).toContain("Use value-based compression instead of hard length caps");
    expect(result).toContain("file-by-file diff narration");
    expect(result).toContain("Keep the memory boundary explicit");
    expect(result).toContain("include memory-specific evidence only when material");
    expect(result).toContain("Worker-stream checkpoints are optional early visibility");
    expect(result).toContain("takode worker-stream");
    expect(result).toContain("do not let it replace phase documentation");
    expect(result).toContain("Final chat handoffs are compact pointers, not second phase notes");
    expect(result).toContain("Detailed phase results, recommended next action, blockers, evidence, findings");
    expect(result).toContain("Port's selected target plus ordered `Synced SHAs:`");
    expect(result).toContain("final Memory's required memory statement");
    expect(result).toContain("If the actor's context was compacted during the phase");
    expect(result).toContain("Provide only deltas the actor is unlikely to infer");
    expect(result).toContain("without spending scan space on incidental raw details");
    expect(result).toContain("Bookkeeping is compatibility-only for targeted intermediate durable state");
    expect(result).toContain("Every completed non-cancelled quest ends in Memory");
    expect(result).toContain(
      "Completion without final Memory closure, final User review check settlement, final debrief metadata, debrief TLDR metadata, and quest metadata reconciliation is incomplete",
    );
    expect(result).toContain("title, TLDR, and description still match the accepted delivered scope");
    expect(result).toContain("ambiguous or intent-changing edits route back to the leader or user");
    expect(result).toContain("omits `port` but still ends in `memory`");
    expect(result).toContain("attach their synced SHAs before final Memory");
    expect(result).toContain("A quest in `MEMORY` is downstream-unblocking");
    expect(result).toContain("quest feedback add q-N --text-file /tmp/phase.md --tldr-file /tmp/phase-tldr.md");
    expect(result).toContain("use explicit `--phase`, `--phase-position`, `--phase-occurrence`");
    expect(result).toContain("Reviewers should judge phase documentation quality, not just presence");
    expect(result).toContain("significant ambiguity, scope change, Journey revision, user-visible tradeoff");
    expect(result).toContain("point the worker at the exact prior messages, quests, or discussions");
    expect(result).toContain(
      "Use `mental-simulation` when the question is whether a design, workflow, or responsibility split makes sense under replayed scenarios.",
    );
    expect(result).toContain(
      "a reviewer should make an acceptance judgment on external evidence the worker has usually already produced",
    );
    expect(result).toContain("reviewers may do only small bounded reruns or repros");
    expect(result).toContain("approval-gated runs rather than a reviewer acceptance pass");
    expect(result).toContain("route back deliberately: `implement` for behavior/code changes");
    expect(result).toContain("| Built-in phase | Board state | Leader brief | Assignee brief | Next leader action |");
    expect(result).toContain("~/.companion/quest-journey-phases/<phase-id>/");
    expect(result).toContain("`~/.companion/quest-journey-phases/alignment/leader.md`");
    expect(result).toContain("`~/.companion/quest-journey-phases/alignment/assignee.md`");
    expect(result).toContain("one confirmation can approve quest text, Journey, and dispatch plan");
    expect(result).not.toContain("Every dispatched task follows the **Quest Journey** lifecycle");
    expect(result).not.toContain("Every quest goes through the full journey");
  });

  it("builds a worker prompt without orchestrator guardrails unless requested", () => {
    const result = buildInjectedSystemPromptForDebug({ sessionNum: 8, backend: "codex" });

    expect(result).toContain("You are Takode session #8.");
    expect(result).toContain("## Durable Names and Quest IDs");
    expect(result).toContain("Do not put quest IDs in Takode-external durable names");
    expect(result).not.toContain("Takode -- Cross-Session Orchestration");
    expect(result).not.toContain("## Durable Names in Handoffs");
    expect(result).not.toContain("leader-dispatch");
  });
});
