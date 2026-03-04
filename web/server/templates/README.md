# `web/server/templates/`

Static markdown templates used by server-side integration/setup code.

These files are copied/read at runtime to generate guardrails and skill
documentation in user/worktree environments.

## Files

- [orchestrator-guardrails.md](./orchestrator-guardrails.md)
  - Baseline instructions for orchestrator/leader sessions.
  - Injected by Takode integration flows.

- [quest-skill-docs.md](./quest-skill-docs.md)
  - Questmaster skill content and workflow guidance.
  - Used to install/update quest docs in backend skill directories.

## Primary consumers

- [../takode-integration.ts](../takode-integration.ts)
  - Loads orchestrator template and applies it to relevant workspaces.
- [../quest-integration.ts](../quest-integration.ts)
  - Loads quest template and materializes quest skill docs/wrappers.

## Editing guidance

- Treat these as user-facing operational docs, not internal comments.
- Keep references and command examples consistent with current CLI behavior.
- Prefer explicit, deterministic wording since these templates influence agent behavior.

## Lifecycle

1. Template text is authored in this directory.
2. Integration modules read these files at runtime.
3. Rendered docs/guardrails are copied into workspace-specific locations.
4. Sessions launched in those workspaces inherit the resulting instructions.

## Common pitfalls

- Changing command names here without updating CLI behavior causes stale guidance.
- Overly broad instructions can unintentionally change orchestration/quest behavior.
- Breaking markdown links in templates degrades in-app navigation affordances.

## Validation checklist after edits

- Confirm integration code still resolves the template path.
- Run backend tests for:
  - `quest-integration`
  - `takode-integration`
- Verify generated files in a fresh session/worktree setup.

## Scope reminder

These files are templates only. Runtime logic remains in:
- [../quest-integration.ts](../quest-integration.ts)
- [../takode-integration.ts](../takode-integration.ts)
