---
name: self-improvement
description: |
  Turn mistakes, corrections, and suboptimal behavior into reusable improvements.
  Proposes quest-based durable improvements for CLAUDE.md/AGENTS.md instructions,
  skills, system prompt tweaks, utility code, or other code changes.
  Invoke this skill when:
  - The user corrects agent behavior and the correction feels generalizable
  - A workflow failure could have been prevented by better instructions or tooling
  - The agent realizes mid-task it's repeating a mistake it's made before
  - A discussion produces a new principle or process worth preserving
  - The user asks to 'self-improve', 'capture this as a rule', 'remember this',
    'add this to CLAUDE.md', 'add this to AGENTS.md', or 'learn from this mistake'
argument-hint: "[what went wrong or should be improved]"
---

# /self-improvement -- Turn Mistakes Into Reusable Improvements

You are running the self-improvement workflow. Turn a mistake, correction, or
suboptimal behavior from this conversation into a quest-ready improvement. For
durable, non-trivial changes such as CLAUDE.md/AGENTS.md additions, skill
updates, system prompt changes, utility code, or other code changes, do not
apply the change directly from this workflow.

**Note on instruction files:** Claude Code reads `CLAUDE.md` and Codex reads
`AGENTS.md`. Throughout this workflow, "CLAUDE.md" means whichever instruction
file a rule must reach. Check both when searching for existing guidance, and
target every file the rule must reach.

Follow these steps exactly. Do not skip steps.

## Quest-First Rule

For durable, non-trivial instruction, skill, prompt, utility, or code changes,
the output of this workflow is a quest proposal, not a direct patch.

- If this is a leader/orchestrator session, gather enough context and rough root
  cause, then propose the quest text plus a Quest Journey/scheduling plan for
  user approval. If the improvement should be dispatched, use the local
  quest-design and leader-dispatch workflow instead of implementing it yourself.
- If this is not a leader/orchestrator session, gather enough context and rough
  root cause, then propose a quest for the improvement and stop for user or
  leader routing. Do not directly apply the durable change.
- If the self-improvement prompt reveals an active live operational miss, such
  as a missing `needs-input` notification for a current user wait, fix that
  narrow operational miss first. Then return to this quest-first workflow for
  the durable instruction or code change.

## Step 0: Confirm With the User

If you loaded this skill proactively (not via an explicit `/self-improvement`
command from the user), briefly explain what you noticed and ask whether the
user wants you to proceed with the self-improvement workflow. For example:

> "I notice [pattern/correction]. Want me to run through the self-improvement
> workflow to capture this as a reusable rule?"

**Do not proceed to Step 1 without user confirmation.** If the user declines,
drop it -- do not push.

If the user explicitly ran `/self-improvement`, skip this step.

## Step 1: Identify the Failure

Review the current conversation to identify what went wrong or should be improved.

**If the user described the problem** (for example in text after
`/self-improvement`), use it as the starting point. Still review conversation
context to understand the full picture.

**Otherwise**, scan the conversation for:
- Explicit corrections from the user ("no, do it this way", "don't do X")
- Moments where you had to redo work
- Patterns where you made suboptimal choices
- Discussions that concluded with "we should always do X"

Produce a short **failure summary** (3-5 sentences):
1. **What happened**: The specific mistake or suboptimal behavior
2. **Why**: Root cause (missing knowledge, wrong assumption, no tooling, etc.)
3. **Impact**: What time/effort was wasted or what risk was introduced
4. **Generalizability**: One-off or recurring pattern?

If you cannot identify a clear improvement opportunity, tell the user and ask
them to clarify. Do not proceed with a vague or forced improvement.

## Step 2: Check Existing Guidance

Before drafting, check what guidance already exists. Read these files if present:

- `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (the user's personal
  instructions)
- The project root `CLAUDE.md` and `AGENTS.md`
- The project `.claude/CLAUDE.md` and `.claude/AGENTS.md`

Search for overlapping skills:

- List the skills in `~/.claude/skills/` and `~/.agents/skills/` (installed for
  every project) and in the project's `.claude/skills/` and `.agents/skills/`
- Grep CLAUDE.md and AGENTS.md files for keywords related to the failure

Determine:
- Does guidance for this already exist? Is it insufficient, unclear, or ignored?
- Would the new improvement conflict with existing instructions?
- Is there an existing section where this naturally fits?

If the improvement already exists and is adequate, tell the user:
"This is already covered in [file] under [section]. The issue may be that I
failed to follow existing guidance rather than that guidance is missing."
Ask if they still want to proceed.

## Step 3: Choose Improvement Type, Scope, and Quest Draft

Based on the failure analysis, choose one or more improvement types, then
pick the right scope for each. Use this to draft the proposed quest's goal,
acceptance criteria, evidence, and likely instruction/code surfaces. Do not
edit those surfaces directly as part of this workflow.

### Improvement Types

#### CLAUDE.md / AGENTS.md Addition
Best for: behavioral rules, preferences, workflow principles, guardrails.

Draft rules:
- Imperative mood ("Do X", "Never Y", "Prefer A over B")
- Specific and actionable -- no vague platitudes
- Include the "why" briefly if not obvious
- Keep to 1-4 lines unless complexity demands more
- Identify the target section in the existing file, or propose a new section name

#### Skill Update or New Skill
Best for: workflow-specific guidance, multi-step procedures with specific
ordering. If the improvement is scoped to a particular skill's domain, update
that skill's SKILL.md rather than adding to CLAUDE.md.

Draft or update the skill: frontmatter (name, description, argument-hint) and
body (step-by-step workflow, safety gates). Follow the pattern of existing
skills in the folders listed in Step 2.

#### Code Change
Best for: when the root cause is a tooling gap, missing feature, or buggy
behavior in code. The improvement IS a code change -- not just instructions
telling the agent to work around the problem.

Code changes include: server code, injected system prompts, CLI tools, utility
scripts, adapters, or any runtime code that shapes agent behavior. Route these
through a quest rather than implementing them directly from self-improvement.

#### Utility Code
Best for: standalone helper scripts, automation gaps, one-off tools that don't
fit into existing codebases.

Draft the code with clear comments explaining purpose and usage.

#### Combination
When the improvement naturally spans multiple types, draft all pieces.

### Choosing the Right Scope

Pick the narrowest scope that covers the improvement. Ask: "Where does this
rule need to be enforced, and by whom?"

| Scope | Target | When to use |
|-------|--------|-------------|
| **Personal cross-project** | The user's personal instructions | Personal preferences and behavioral rules that apply to all projects (formatting, git habits, code style) |
| **Project-specific** | Project root `CLAUDE.md` | Architecture conventions, testing patterns, and domain rules specific to one codebase |
| **Injected system prompt** | Takode server code that injects prompts | Behavioral rules for specific session types (leader, worker, reviewer, regular) that apply across all projects using that session type |
| **Skill-specific** | The skill's source `SKILL.md` | Guidance scoped to a particular workflow or skill invocation |
| **Code** | Source code | When the root cause is a tooling gap, missing feature, or bug -- the improvement is the code itself |

**Common mistake**: putting session-type rules (e.g., "leaders should do X") in
a project CLAUDE.md when they belong in the injected system prompt, since they
apply to any session of that type regardless of project.

**Name the source, not an installed copy.** Files in a user's home folder may be
copies installed from elsewhere, and an edit there can be lost or detach that
file from future updates:
- When Takode manages the user's instructions and skills (a
  `~/.companion/user-instructions` or `~/.companion/user-skills` store exists on
  the machine running the Takode server), personal rules belong in the store's
  `user-instructions/all.md` (or `claude.md`/`codex.md` for one backend) and
  personal skills in `user-skills/<all|claude|codex>/<skill>/`. Never edit a
  machine's `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md` copy.
- Skill folders are often links. Resolve the entry (for example with
  `readlink`) to find the repository or store that holds the skill's source.

## Step 4: Present Quest Proposal to User

Present the final proposal clearly. Include:

1. **What happened** (1-2 sentences -- the failure)
2. **Proposed quest** (title, goal/acceptance, and context/evidence)
3. **Likely surfaces** (files, skills, prompt builders, or code areas to inspect)
4. **Routing** (leader sessions include Quest Journey and scheduling; non-leader
   sessions ask the user or leader to create/dispatch the quest)

For CLAUDE.md/AGENTS.md, skill, prompt, or code changes, describe the intended
surface and the exact behavior the quest should achieve. Do not present this as
an "apply this patch now" approval.

Ask for approval or correction. In a Takode session, use
`takode notify needs-input`: put the proposal in its context, which appears in
the chat as a message, and add suggested replies; do not explain the proposal
again in a separate message. Outside Takode, ask in plain text. Do NOT use
AskUserQuestion: its modal covers the proposal while the user decides.
Leader/orchestrator sessions apply leader-decision-communication first and
never represent the wait only with `Thread Waiting`; workers ask their leader
the same way.

**Do not proceed without explicit user approval.**

## Step 5: Route the Quest

On approval:

- **Leader/orchestrator session**: create or refine the quest using the approved
  text, record the approved Quest Journey/scheduling plan, and dispatch or queue
  it according to the local leader-dispatch workflow. Do not implement the
  durable change yourself.
- **Non-leader session**: create the quest only if the local workflow and user
  approval explicitly allow it; otherwise report the approved quest proposal to
  the user or leader and stop. Do not implement the durable change yourself.
- **Immediate live operational miss**: if you already fixed a narrow live miss
  before drafting the durable proposal, mention that operational repair
  separately from the quest routing.

After routing, briefly confirm where the quest proposal went and what remains
for the assigned worker or future Journey phases.

---

## Quality Bar

A good self-improvement:
- Would have prevented the specific failure
- Is general enough for similar future situations
- Is specific enough that following it is unambiguous
- Is concise -- ideally 1-3 lines for CLAUDE.md/AGENTS.md additions
- Fits naturally with existing instructions in tone and style
